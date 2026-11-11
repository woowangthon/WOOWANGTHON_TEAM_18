#!/usr/bin/env bash
# Build BE/ and (re)start it as a container on the platform EC2. Run on the EC2 from a clone of the team repo:
#   bash Infra/aws/deploy-be.sh [git-ref]        (default: origin/main; the user must be in the docker group)
# Settings come from SSM Parameter Store under $SSM_PATH (default /wcp/be): one SecureString per variable,
# named like the variables in BE/.env.example (e.g. /wcp/be/SUPABASE_SECRET_KEY). The instance role needs
# ssm:GetParametersByPath + kms:Decrypt on that path. Values go to an owner-only env file and are never printed.
# docker --env-file is one line per variable, so every value must be a single line (store a PEM as base64).
# PORT is set here, not in SSM.
# The container listens on host port 80: Cloudflare proxies api.stairnoworks.com to it (3000 is not a port
# Cloudflare proxies). The security group should open 80 to Cloudflare's IP ranges only.
# If the new container fails its health check, the previous image is started again.
set -euo pipefail

run() { # run <image>
  docker rm -f wcp-be >/dev/null 2>&1 || true
  docker run -d --name wcp-be --restart unless-stopped -p 80:3000 --env-file "$env_file" -e PORT=3000 "$1" >/dev/null
}

healthy() {
  for _ in $(seq 30); do
    curl -fsS http://127.0.0.1/api/health >/dev/null && return 0
    sleep 2
  done
  return 1
}

main() {
  local ref=${1:-origin/main} ssm_path=${SSM_PATH:-/wcp/be} image previous
  env_file=${ENV_FILE:-$HOME/.config/wcp/be.env}
  cd "$(dirname "$0")/../.."

  git fetch --quiet origin
  git checkout --quiet --detach "$ref"
  image=wcp-be:$(git rev-parse --short HEAD)
  docker build -t "$image" BE

  install -d -m 700 "$(dirname "$env_file")"
  umask 077
  aws ssm get-parameters-by-path --path "$ssm_path" --with-decryption --recursive \
    --query 'Parameters[].[Name,Value]' --output text |
    while IFS=$'\t' read -r name value; do printf '%s=%s\n' "${name##*/}" "$value"; done > "$env_file.new"
  grep -q '^SUPABASE_SECRET_KEY=' "$env_file.new" || { echo "no SUPABASE_SECRET_KEY under $ssm_path" >&2; rm -f "$env_file.new"; exit 1; }
  mv "$env_file.new" "$env_file"

  previous=$(docker inspect -f '{{.Config.Image}}' wcp-be 2>/dev/null || true)
  run "$image"
  # The server stops at boot on a bad setting (BE/src/config/env.ts), so a failed health check usually means a bad value.
  if healthy; then echo "$image is up"; exit 0; fi
  echo "$image failed the health check; last log lines:" >&2
  docker logs --tail 30 wcp-be >&2
  if [ -n "$previous" ] && [ "$previous" != "$image" ]; then
    run "$previous"
    if healthy; then echo "rolled back to $previous" >&2; else echo "rollback to $previous is not healthy either" >&2; fi
  fi
  exit 1
}

# The whole script is read before main runs, so checking out another version of this file cannot change it mid-run.
main "$@"
