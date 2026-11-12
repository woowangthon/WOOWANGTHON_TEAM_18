#!/usr/bin/env bash
# Start the GoCD server and the AWS executor on the platform EC2 (docs/design/platform-hosting.md "GoCD 서버 · AWS 실행기"):
#   bash Infra/aws/start-gocd.sh        (the user must be in the docker group; Tailscale must be up)
# Run it once, and again after the settings or the repo change: it only does what is missing.
# Settings are read from SSM Parameter Store under $SSM_PATH (default /wcp/gocd), one single-line SecureString per variable:
#   ADMIN_PASSWORD          GoCD's admin user (16+ characters); the platform server's user `be` needs no value (setup.sh makes its password)
#   PIPELINE_NOTIFY_TOKEN   the same value as /wcp/be/PIPELINE_NOTIFY_TOKEN (32+ characters)
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   the executor-only IAM user wcp-gocd-aws-agent (CodeBuild only)
#   TAILNET_ADDR            optional: this EC2's Tailscale address; defaults to `tailscale ip -4`
# The server port is bound to that Tailscale address only, so nothing outside the tailnet reaches it (ADR-009, #128).
# A new server has no login, so it first listens on 127.0.0.1 only; it is published on the tailnet after setup.sh turned login on.
# What it leaves for the operator (files in $STATE, mode 0600, never printed):
#   be-gocd-token      -> SSM /wcp/be/GOCD_TOKEN  (aws ssm put-parameter --type SecureString --value file://...)
#   leader-agent.env   -> the leader's Secret `gocd-agent` (Infra/executor/agent.yaml header)
set -euo pipefail
ssm_path=${SSM_PATH:-/wcp/gocd}
state=${GOCD_STATE:-$HOME/.config/wcp/gocd}
cd "$(dirname "$0")/../.."
compose=(docker compose -f Infra/gocd/compose.yaml)

ssm() { aws ssm get-parameters-by-path --path "$ssm_path" --with-decryption --recursive --output text --query "$1"; }

# Settings first, so a missing value stops the script before anything starts.
# A value must be one line (the same rule as deploy-be.sh).
install -d -m 700 "$state"
umask 077
multi=$(ssm 'Parameters[?contains(Value, `"\n"`)].Name')
[[ -z $multi ]] || { echo "these values under $ssm_path span several lines: $multi" >&2; exit 1; }
# The values go into this script's environment (no file), and from there only to the processes that need them.
# A failed read leaves them empty, which the check below reports.
while IFS=$'\t' read -r name value; do export "${name##*/}=$value"; done < <(ssm 'Parameters[].[Name,Value]')
for v in ADMIN_PASSWORD PIPELINE_NOTIFY_TOKEN AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
  [[ -n ${!v-} ]] || { echo "no $v under $ssm_path" >&2; exit 1; }
done
export GOCD_ADMIN_PASSWORD=$ADMIN_PASSWORD
unset ADMIN_PASSWORD

export GOCD_STATE=$state
export GOCD_TAILNET_ADDR=${TAILNET_ADDR:-$(tailscale ip -4 2>/dev/null | head -1)}
[[ -n $GOCD_TAILNET_ADDR ]] || { echo "no Tailscale address: bring Tailscale up or set TAILNET_ADDR" >&2; exit 1; }

# Loopback until login is on (setup.sh step 1 and everything after it), then the same container data on the Tailscale address.
GOCD_BIND=127.0.0.1 "${compose[@]}" up -d gocd-server
GOCD_URL=http://127.0.0.1:8153 bash Infra/gocd/setup.sh
# Exported: the agent's `up` below also brings up gocd-server (depends_on) and must keep this binding.
export GOCD_BIND=$GOCD_TAILNET_ADDR
"${compose[@]}" up -d gocd-server
"${compose[@]}" --profile agents up -d --build aws-agent

# The agent registers by itself (Agents page of the GoCD UI over the tailnet: resource aws).
echo "gocd-server and gocd-aws-agent are up. Next: put $state/be-gocd-token into SSM /wcp/be/GOCD_TOKEN and apply"
echo "$state/leader-agent.env as the leader's Secret (see the header of Infra/executor/agent.yaml)."
