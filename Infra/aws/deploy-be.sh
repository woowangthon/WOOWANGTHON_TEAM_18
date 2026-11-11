#!/usr/bin/env bash
# Build BE/ at a git ref and run it as the container wcp-be on the platform EC2 (docs/design/platform-hosting.md):
#   bash Infra/aws/deploy-be.sh [git-ref]        (default: origin/main; the user must be in the docker group)
# Settings are read from SSM Parameter Store under $SSM_PATH (default /wcp/be), one single-line value per variable.
# If the new container fails its health check, the previous container (same image and settings) is started again.
set -euo pipefail
ref=${1:-origin/main}
ssm_path=${SSM_PATH:-/wcp/be}
env_file=${ENV_FILE:-$HOME/.config/wcp/be.env}
cd "$(dirname "$0")/../.."

answers() { curl -fsS --max-time 5 http://127.0.0.1:3000/api/health >/dev/null; }
healthy() {
  for _ in $(seq 30); do
    answers && return 0
    sleep 2
  done
  return 1
}
ssm() { aws ssm get-parameters-by-path --path "$ssm_path" --with-decryption --recursive --output text --query "$1"; }

# Settings first, so a missing value stops the script before a build.
# docker --env-file cannot carry a multi-line value, so one is refused here.
install -d -m 700 "$(dirname "$env_file")"
umask 077
multi=$(ssm 'Parameters[?contains(Value, `"\n"`)].Name')
[[ -z $multi ]] || { echo "these values under $ssm_path span several lines: $multi" >&2; exit 1; }
ssm 'Parameters[].[Name,Value]' |
  while IFS=$'\t' read -r name value; do printf '%s=%s\n' "${name##*/}" "$value"; done > "$env_file.new"
grep -q '^SUPABASE_SECRET_KEY=' "$env_file.new" || { echo "no SUPABASE_SECRET_KEY under $ssm_path" >&2; exit 1; }

# Build from the ref itself: the clone this script runs from is not checked out or changed.
git fetch --quiet origin
image=wcp-be:$(git rev-parse --short "$ref^{commit}")
git archive "$ref:BE" | docker build -t "$image" -
mv "$env_file.new" "$env_file"

# A run that stopped half way leaves wcp-be-prev behind. Drop it only if wcp-be is answering; otherwise it is the
# last good container, so it becomes wcp-be again.
if docker container inspect wcp-be-prev >/dev/null 2>&1; then
  if answers; then docker rm -f wcp-be-prev >/dev/null
  else docker rm -f wcp-be >/dev/null 2>&1 || true; docker rename wcp-be-prev wcp-be; fi
fi

# Keep the old container (its image and settings) until the new one is healthy. Port 3000 is freed by stopping it.
# The port is bound to 127.0.0.1 only: requests come in through the tunnel (Infra/aws/start-tunnel.sh).
had_previous=false
if docker stop wcp-be >/dev/null 2>&1; then docker rename wcp-be wcp-be-prev; had_previous=true; fi

if docker run -d --name wcp-be --restart unless-stopped -p 127.0.0.1:3000:3000 --env-file "$env_file" -e PORT=3000 "$image" >/dev/null && healthy; then
  docker rm wcp-be-prev >/dev/null 2>&1 || true
  docker images wcp-be --format '{{.Repository}}:{{.Tag}}' | grep -vx "$image" | xargs -r docker rmi >/dev/null 2>&1 || true
  echo "$image is up"
  exit 0
fi
# The server stops at boot on a bad setting (BE/src/config/env.ts), so this is usually a bad value.
echo "$image did not start or failed the health check; last log lines:" >&2
docker logs --tail 30 wcp-be >&2 || true
docker rm -f wcp-be >/dev/null 2>&1 || true
if $had_previous; then
  if docker rename wcp-be-prev wcp-be && docker start wcp-be >/dev/null && healthy; then
    echo "rolled back to the previous container" >&2
  else
    echo "the previous container did not come back; check docker ps -a" >&2
  fi
fi
exit 1
