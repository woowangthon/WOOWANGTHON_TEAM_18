#!/usr/bin/env bash
# Build AI/ at a git ref and run it as the container wcp-ai on the platform EC2 (docs/design/platform-hosting.md):
#   bash Infra/aws/deploy-ai.sh [git-ref]        (default: origin/main; the user must be in the docker group)
# Settings are read from SSM Parameter Store under $SSM_PATH (default /wcp/ai), one single-line value per variable.
# wcp-ai and wcp-be share the docker network wcp: BE calls http://wcp-ai:8000, the AI calls the gateway at
# http://wcp-be:<GATEWAY_PORT>/mcp. Port 8000 is published on 127.0.0.1 only, for the health check.
# If the new container fails its health check, the previous container (same image and settings) is started again.
set -euo pipefail
ref=${1:-origin/main}
ssm_path=${SSM_PATH:-/wcp/ai}
env_file=${ENV_FILE:-$HOME/.config/wcp/ai.env}
network=wcp
cd "$(dirname "$0")/../.."

# One deploy at a time: two runs would race on wcp-ai / wcp-ai-prev and the env file.
exec 9>"${XDG_RUNTIME_DIR:-/tmp}/wcp-ai-deploy.lock"
flock -n 9 || { echo "another deploy-ai.sh is running" >&2; exit 1; }

answers() { curl -fsS --max-time 5 http://127.0.0.1:8000/health >/dev/null; }
healthy() {
  for _ in $(seq 30); do
    answers 2>/dev/null && return 0  # refused/reset while the server is still booting
    sleep 2
  done
  return 1
}
ssm() { aws ssm get-parameters-by-path --path "$ssm_path" --with-decryption --recursive --output text --query "$1"; }

# A run that stopped half way leaves wcp-ai-prev behind (stopped). Drop it only if wcp-ai is answering; otherwise it
# is the last good container, so it becomes wcp-ai again and is started. This comes before the settings and the build,
# so a later failure there still leaves the AI server running.
if docker container inspect wcp-ai-prev >/dev/null 2>&1; then
  if answers; then docker rm -f wcp-ai-prev >/dev/null
  else
    docker rm -f wcp-ai >/dev/null 2>&1 || true
    docker rename wcp-ai-prev wcp-ai
    if docker start wcp-ai >/dev/null && healthy; then echo "restored wcp-ai from an earlier run that stopped half way" >&2
    else echo "wcp-ai from an earlier run did not come back; deploying anyway" >&2; fi
  fi
fi

# Settings first, so a missing value stops the script before a build.
# docker --env-file cannot carry a multi-line value, so one is refused here.
install -d -m 700 "$(dirname "$env_file")"
umask 077
multi=$(ssm 'Parameters[?contains(Value, `"\n"`)].Name')
[[ -z $multi ]] || { echo "these values under $ssm_path span several lines: $multi" >&2; exit 1; }
ssm 'Parameters[].[Name,Value]' |
  while IFS=$'\t' read -r name value; do printf '%s=%s\n' "${name##*/}" "$value"; done > "$env_file.new"
# Without these two the server stops at boot (AI/ai_server/config.py). The model settings may be left out:
# the server then answers every ticket with gave_up.
for key in AGENT_API_TOKEN GATEWAY_URL; do
  grep -q "^$key=" "$env_file.new" || { echo "no $key under $ssm_path" >&2; exit 1; }
done

# Build from the ref itself: the clone this script runs from is not checked out or changed.
git fetch --quiet origin
image=wcp-ai:$(git rev-parse --short "$ref^{commit}")
# Unpacked into a folder: a tar on stdin fails on the EC2's docker 25 + buildx 0.17 ("no http response from session").
src=$(mktemp -d)
# umask 022 for the unpacking only: a non-root tar applies the umask 077 set above for the env file, and files the image
# copies straight from the context would then be unreadable to its non-root user.
git archive "$ref:AI" | (umask 022; tar -x -C "$src")
docker build -t "$image" "$src" || { rm -rf "$src"; exit 1; }
rm -rf "$src"
mv "$env_file.new" "$env_file"

docker network inspect "$network" >/dev/null 2>&1 || docker network create "$network" >/dev/null

# Keep the old container (its image and settings) until the new one is healthy. Port 8000 is freed by stopping it.
had_previous=false
if docker stop wcp-ai >/dev/null 2>&1; then docker rename wcp-ai wcp-ai-prev; had_previous=true; fi

if docker run -d --name wcp-ai --restart unless-stopped --network "$network" -p 127.0.0.1:8000:8000 \
  --env-file "$env_file" -e PORT=8000 "$image" >/dev/null && healthy; then
  docker rm wcp-ai-prev >/dev/null 2>&1 || true
  docker images wcp-ai --format '{{.Repository}}:{{.Tag}}' | grep -vx "$image" | xargs -r docker rmi >/dev/null 2>&1 || true
  echo "$image is up"
  exit 0
fi
# The server stops at boot on a bad setting (AI/ai_server/config.py), so this is usually a bad value.
echo "$image did not start or failed the health check; last log lines:" >&2
docker logs --tail 30 wcp-ai >&2 || true
docker rm -f wcp-ai >/dev/null 2>&1 || true
if $had_previous; then
  if docker rename wcp-ai-prev wcp-ai && docker start wcp-ai >/dev/null && healthy; then
    echo "rolled back to the previous container" >&2
  else
    echo "the previous container did not come back; check docker ps -a" >&2
  fi
fi
exit 1
