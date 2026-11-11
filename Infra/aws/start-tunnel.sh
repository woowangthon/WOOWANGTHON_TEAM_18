#!/usr/bin/env bash
# Run the tunnel client (cloudflared) on the platform EC2, so https://api.stairnoworks.com reaches the BE container
# (docs/design/platform-hosting.md). Run once, and again after the token or the version changes:
#   bash Infra/aws/start-tunnel.sh        (the user must be in the docker group)
# The tunnel is made in the Cloudflare dashboard; its token is the SSM SecureString $TOKEN_PARAM (see the design doc).
set -euo pipefail
token_param=${TOKEN_PARAM:-/wcp/tunnel/TUNNEL_TOKEN}

TUNNEL_TOKEN=$(aws ssm get-parameter --name "$token_param" --with-decryption --query Parameter.Value --output text)
export TUNNEL_TOKEN
docker rm -f wcp-tunnel >/dev/null 2>&1 || true
# Host network: the BE listens on 127.0.0.1:3000 only. `-e TUNNEL_TOKEN` copies the value from this environment,
# so it is not on any command line. /ready on the metrics port is 200 once a connection to Cloudflare is up.
# Same image tag as the leader's client (Infra/cloudflared/cloudflared.yaml); bump both together.
docker run -d --name wcp-tunnel --restart unless-stopped --network host -e TUNNEL_TOKEN \
  cloudflare/cloudflared:2026.10.7 tunnel --no-autoupdate --metrics 127.0.0.1:2000 run >/dev/null

for _ in $(seq 15); do
  curl -fsS --max-time 5 http://127.0.0.1:2000/ready >/dev/null 2>&1 && { echo "wcp-tunnel is connected"; exit 0; }
  sleep 2
done
echo "wcp-tunnel did not connect; last log lines:" >&2
docker logs --tail 20 wcp-tunnel >&2 || true
exit 1
