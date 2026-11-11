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

healthy() {
  for _ in $(seq 30); do
    curl -fsS http://127.0.0.1/api/health >/dev/null && return 0
    sleep 2
  done
  return 1
}

# Settings first, so a missing value stops the script before a build. A multi-line value would split into
# lines without a parameter name; docker --env-file cannot carry it, so it is refused here.
install -d -m 700 "$(dirname "$env_file")"
umask 077
aws ssm get-parameters-by-path --path "$ssm_path" --with-decryption --recursive \
  --query 'Parameters[].[Name,Value]' --output text |
  while IFS=$'\t' read -r name value; do
    [[ $name == /* ]] || { echo "a value under $ssm_path spans several lines" >&2; exit 1; }
    printf '%s=%s\n' "${name##*/}" "$value"
  done > "$env_file.new"
grep -q '^SUPABASE_SECRET_KEY=' "$env_file.new" || { echo "no SUPABASE_SECRET_KEY under $ssm_path" >&2; exit 1; }

# Build from the ref itself: the clone this script runs from is not checked out or changed.
git fetch --quiet origin
image=wcp-be:$(git rev-parse --short "$ref^{commit}")
git archive "$ref:BE" | docker build -t "$image" -
mv "$env_file.new" "$env_file"

# Keep the old container (its image and settings) until the new one is healthy. Port 80 is freed by stopping it.
docker rm -f wcp-be-prev >/dev/null 2>&1 || true
had_previous=false
if docker stop wcp-be >/dev/null 2>&1; then docker rename wcp-be wcp-be-prev; had_previous=true; fi
docker run -d --name wcp-be --restart unless-stopped -p 80:3000 --env-file "$env_file" -e PORT=3000 "$image" >/dev/null

if healthy; then
  docker rm wcp-be-prev >/dev/null 2>&1 || true
  docker images wcp-be --format '{{.Repository}}:{{.Tag}}' | grep -vx "$image" | xargs -r docker rmi >/dev/null 2>&1 || true
  echo "$image is up"
  exit 0
fi
# The server stops at boot on a bad setting (BE/src/config/env.ts), so this is usually a bad value.
echo "$image failed the health check; last log lines:" >&2
docker logs --tail 30 wcp-be >&2
docker rm -f wcp-be >/dev/null
if $had_previous; then
  docker rename wcp-be-prev wcp-be && docker start wcp-be >/dev/null
  if healthy; then echo "rolled back to the previous container" >&2; else echo "the previous container is not healthy either" >&2; fi
fi
exit 1
