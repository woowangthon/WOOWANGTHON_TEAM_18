#!/usr/bin/env bash
# Set up a running GoCD server (compose.yaml) through its API. The same script runs on a developer machine and on the EC2;
# run it again after a change and it only does what is missing:
#   GOCD_ADMIN_PASSWORD=... bash Infra/gocd/setup.sh
# It
#   1. turns on login (file-based, two users: `admin` and `be`), so the API is no longer open,
#   2. makes `admin` the only system administrator and gives `be` the operate right on the pipeline group `wcp` and nothing else,
#   3. registers this repo as the config repo (Infra/gocd/*.gocd.yaml defines the pipeline),
#   4. creates the access token the platform server uses (BE env GOCD_TOKEN) as the user `be`, once,
#   5. writes what the agents need.
# The platform server's token must not be an administrator's: with the config repo's rights it could register a repo whose
# pipeline runs a command on the AWS executor and reads the AWS key from its environment (platform-hosting.md). `be` can
# schedule and cancel a run and read the pipeline; it cannot change the server. Its password is made here for each run and is
# not stored: it is only used to create the token (the token is the credential the platform server keeps).
# PIPELINE_NOTIFY_TOKEN is not stored in GoCD: GoCD cannot attach a secure variable to a config-repo pipeline (an environment
# in the server's own config may not reference it, and a value encrypted into the YAML would need this server's key), and its
# secret-manager plugin is not bundled. The token is the agents' own environment, like the AWS key (compose.yaml, the leader Secret).
# Settings (environment):
#   GOCD_ADMIN_PASSWORD     required, 16+ characters
#   PIPELINE_NOTIFY_TOKEN   only for the leader Secret file: the same value as the platform server's (32+ characters)
#   GOCD_URL                default http://127.0.0.1:8153
#   CONFIG_REPO_URL, CONFIG_REPO_BRANCH   default: the team repo, main
#   GOCD_TAILNET_ADDR       optional, the server's tailnet address; adds the leader agent's Secret file
#   GOCD_STATE              default ~/.config/wcp/gocd (0700). Files written there (0600), never printed:
#     be-gocd-token         the access token -> SSM /wcp/be/GOCD_TOKEN
#     agent.env             AGENT_AUTO_REGISTER_KEY, read by compose.yaml
#     leader-agent.env      the leader Pod's Secret `gocd-agent` (Infra/executor/agent.yaml): server URL, register key, notify token
# Needs docker (the server container is named gocd-server), curl and sed.
set -euo pipefail
set +x

url=${GOCD_URL:-http://127.0.0.1:8153}
repo_url=${CONFIG_REPO_URL:-https://github.com/woowangthon/WOOWANGTHON_TEAM_18.git}
repo_branch=${CONFIG_REPO_BRANCH:-main}
state=${GOCD_STATE:-$HOME/.config/wcp/gocd}
pipeline=student-deploy
password_file=/godata/config/password.properties
admin='admin'
be_user='be'

: "${GOCD_ADMIN_PASSWORD:?set GOCD_ADMIN_PASSWORD}"
# The values go into JSON by hand (there is no jq on the EC2), so only plain characters are accepted.
safe() { [[ $2 =~ ^[A-Za-z0-9._~+/=-]{$3,}$ ]] || { echo "$1 must be $3+ characters of A-Z a-z 0-9 . _ ~ + / = -" >&2; exit 1; }; }
safe GOCD_ADMIN_PASSWORD "$GOCD_ADMIN_PASSWORD" 16
[[ -z ${PIPELINE_NOTIFY_TOKEN-} ]] || safe PIPELINE_NOTIFY_TOKEN "$PIPELINE_NOTIFY_TOKEN" 32

umask 077
install -d -m 700 "$state"
work=$(mktemp -d "$state/.setup.XXXXXX")
trap 'rm -rf "$work"' EXIT
# A fresh password for `be` each run (24 random bytes as hex). curl reads logins from files, so they are not on a command line (ps).
be_password=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
printf 'user = "%s:%s"\n' "$admin" "$GOCD_ADMIN_PASSWORD" > "$work/curl.cfg"
printf 'user = "%s:%s"\n' "$be_user" "$be_password" > "$work/be.cfg"

# api <method> <path> <Accept version> [<json body>]: answer body in $work/out, HTTP status on stdout, ETag in $work/etag.
# While login is off GoCD refuses a request that carries credentials, so they are sent only once `login=1`.
# `cred=$work/be.cfg api ...` sends the call as the user `be`.
login=0
cred=$work/curl.cfg
api() {
  local method=$1 path=$2 accept=$3 body=${4-} args=()
  [[ $login == 1 ]] && args+=(-K "$cred")
  [[ -n $body ]] && { printf '%s' "$body" > "$work/body"; args+=(-H 'Content-Type: application/json' --data-binary "@$work/body"); }
  [[ -n ${IF_MATCH-} ]] && args+=(-H "If-Match: $IF_MATCH")
  curl -sS -X "$method" -D "$work/headers" -o "$work/out" -w '%{http_code}' \
    -H "Accept: application/vnd.go.cd.$accept+json" -H 'X-GoCD-Confirm: true' "${args[@]}" "$url$path"
  sed -n 's/^[Ee][Tt]ag: *"\{0,1\}\([^"\r]*\)"\{0,1\}\r\{0,1\}$/\1/p' "$work/headers" > "$work/etag"
}
must() { echo "$1 failed (HTTP $2)" >&2; sed -n 's/.*"message" *: *"\([^"]*\)".*/\1/p' "$work/out" | head -3 >&2; exit 1; }
# An empty answer (no container, no file) is reported below, so a failing docker exec does not stop the script silently.
agent_key() { docker exec gocd-server sed -n 's/.*agentAutoRegisterKey="\([^"]*\)".*/\1/p' /godata/config/cruise-config.xml || true; }

for _ in $(seq 60); do
  curl -fsS --max-time 5 "$url/go/api/v1/health" > /dev/null 2>&1 && break
  sleep 2
done
curl -fsS --max-time 5 "$url/go/api/v1/health" > /dev/null || { echo "no GoCD server answers at $url" >&2; exit 1; }

# 1. Login. The password file is written first; the bcrypt hashes are made in a throwaway httpd container (stdin, not argv).
htpasswd_line() { printf '%s\n' "$2" | docker run --rm -i httpd:2.4.70-alpine htpasswd -niB "$1"; }
{ htpasswd_line "$admin" "$GOCD_ADMIN_PASSWORD"; htpasswd_line "$be_user" "$be_password"; } |
  docker exec -i gocd-server sh -c "umask 077; cat > $password_file"
code=$(api GET /go/api/admin/security/auth_configs/file 'v2')
if [[ $code == 404 ]]; then
  code=$(api POST /go/api/admin/security/auth_configs 'v2' \
    "{\"id\":\"file\",\"plugin_id\":\"cd.go.authentication.passwordfile\",\"properties\":[{\"key\":\"PasswordFilePath\",\"value\":\"$password_file\"}]}")
  [[ $code == 200 || $code == 201 ]] || must "creating the login" "$code"
  echo "login turned on (user $admin)"
elif [[ $code != 401 ]]; then
  must "reading the login" "$code"
fi
login=1
# With login on, the same call must now succeed for this user; a 401 here means GOCD_ADMIN_PASSWORD does not match the password file.
code=$(api GET /go/api/admin/security/auth_configs/file 'v2')
[[ $code == 200 ]] || must "logging in as $admin" "$code"

# 2. Rights. With no system administrator named, every user who can log in is one, so `admin` is named first. Then the group
# `wcp` (where the pipeline is) gives `be` view and operate (schedule, cancel) and no administration.
code=$(api GET /go/api/admin/security/system_admins 'v2')
[[ $code == 200 ]] || must "reading the system administrators" "$code"
code=$(IF_MATCH=$(cat "$work/etag") api PUT /go/api/admin/security/system_admins 'v2' "{\"roles\":[],\"users\":[\"$admin\"]}")
[[ $code == 200 ]] || must "naming the system administrator" "$code"
group="{\"name\":\"wcp\",\"authorization\":{\"view\":{\"users\":[\"$be_user\"],\"roles\":[]},\"operate\":{\"users\":[\"$be_user\"],\"roles\":[]},\"admin\":{\"users\":[],\"roles\":[]}}}"
code=$(api GET /go/api/admin/pipeline_groups/wcp 'v1')
if [[ $code == 404 ]]; then
  code=$(api POST /go/api/admin/pipeline_groups 'v1' "$group")
elif [[ $code == 200 ]]; then
  code=$(IF_MATCH=$(cat "$work/etag") api PUT /go/api/admin/pipeline_groups/wcp 'v1' "$group")
fi
[[ $code == 200 || $code == 201 ]] || must "giving $be_user the operate right on wcp" "$code"

# 3. Config repo. GoCD refuses a config repo's pipelines unless a rule lets them into their group.
code=$(api GET "/go/api/admin/config_repos/$pipeline" 'v4')
if [[ $code == 404 ]]; then
  code=$(api POST /go/api/admin/config_repos 'v4' \
    "{\"id\":\"$pipeline\",\"plugin_id\":\"yaml.config.plugin\",\"material\":{\"type\":\"git\",\"attributes\":{\"url\":\"$repo_url\",\"branch\":\"$repo_branch\",\"auto_update\":true}},\"configuration\":[{\"key\":\"file_pattern\",\"value\":\"Infra/gocd/*.gocd.yaml\"}],\"rules\":[{\"directive\":\"allow\",\"action\":\"refer\",\"type\":\"pipeline_group\",\"resource\":\"wcp\"}]}")
  [[ $code == 200 || $code == 201 ]] || must "registering the config repo" "$code"
  echo "config repo registered ($repo_url, $repo_branch)"
elif [[ $code != 200 ]]; then
  must "reading the config repo" "$code"
fi

# The pipeline appears when GoCD has read the YAML.
found=
for _ in $(seq 60); do
  [[ $(api GET "/go/api/admin/pipelines/$pipeline" 'v11') == 200 ]] && { found=1; break; }
  sleep 2
done
[[ -n $found ]] || { echo "the pipeline $pipeline did not appear: look at the config repo's last parse in the GoCD UI (Admin > Config Repositories)" >&2; exit 1; }

# 4. The access token for the platform server (as the user `be`), once: GoCD shows it only at creation.
if [[ ! -s $state/be-gocd-token ]]; then
  code=$(cred=$work/be.cfg api POST /go/api/current_user/access_tokens 'v1' '{"description":"wcp platform server (schedules student-deploy)"}')
  [[ $code == 200 || $code == 201 ]] || must "creating the access token" "$code"
  token=$(sed -n 's/.*"token" *: *"\([^"]*\)".*/\1/p' "$work/out" | head -1)
  [[ -n $token ]] || { echo "the answer had no token" >&2; exit 1; }
  printf '%s\n' "$token" > "$state/be-gocd-token"
  echo "access token written to $state/be-gocd-token (put it in SSM /wcp/be/GOCD_TOKEN)"
fi

# 5. What the agents need.
key=$(agent_key)
[[ -n $key ]] || { echo "could not read the agent auto-register key" >&2; exit 1; }
printf 'AGENT_AUTO_REGISTER_KEY=%s\n' "$key" > "$state/agent.env"
if [[ -n ${GOCD_TAILNET_ADDR-} ]]; then
  : "${PIPELINE_NOTIFY_TOKEN:?the leader Secret needs PIPELINE_NOTIFY_TOKEN}"
  printf 'GO_SERVER_URL=http://%s:8153/go\nAGENT_AUTO_REGISTER_KEY=%s\nPIPELINE_NOTIFY_TOKEN=%s\n' "$GOCD_TAILNET_ADDR" "$key" "$PIPELINE_NOTIFY_TOKEN" > "$state/leader-agent.env"
  echo "leader agent Secret values written to $state/leader-agent.env"
fi
echo "done"
