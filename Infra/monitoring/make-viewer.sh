#!/usr/bin/env bash
# Creates Grafana's view-only account for the operator page's iframe, once, from the operator's machine
# (needs `ssh k3s-leader`):
#   bash Infra/monitoring/make-viewer.sh
# The password is made on the leader and kept in the Secret monitoring/grafana-viewer only; nothing is
# printed. The account lives in Grafana's own database (its volume), so it is not in monitoring.yaml.
# Read the password when you hand it to the operator:
#   ssh k3s-leader 'sudo k3s kubectl -n monitoring get secret grafana-viewer -o jsonpath="{.data.password}" | base64 -d; echo'
set -eu
# tr: a Windows checkout may give this file CRLF line ends, which the leader's bash would not take.
ssh k3s-leader 'tr -d "\r" | bash -s' <<'REMOTE'
set -eu
k() { sudo -n k3s kubectl -n monitoring "$@"; }
if k get secret grafana-viewer >/dev/null 2>&1; then echo "Secret grafana-viewer exists; nothing done"; exit 0; fi
admin=$(k get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d)
pw=$(openssl rand -base64 24)
k port-forward svc/monitoring-grafana 13000:80 >/dev/null 2>&1 &
pf=$!
trap 'kill $pf 2>/dev/null' EXIT
n=0
until curl -s -o /dev/null -m 2 http://127.0.0.1:13000/api/health; do
  n=$((n + 1)); [ $n -lt 20 ] || { echo "Grafana did not answer on the port-forward"; exit 1; }
  sleep 1
done
# Credentials go to curl through a config file and the body on stdin, not as arguments.
code=$(printf '{"name":"Operator page","login":"viewer","password":"%s"}' "$pw" |
  curl -s -K <(printf 'user = "admin:%s"\n' "$admin") -o /dev/null -w '%{http_code}' \
    -H 'Content-Type: application/json' -d @- http://127.0.0.1:13000/api/admin/users)
[ "$code" = 200 ] || { echo "Grafana refused to create the account (HTTP $code)"; exit 1; }
k create secret generic grafana-viewer --from-literal=user=viewer --from-literal=password="$pw" >/dev/null
echo "created the account viewer (role Viewer) and the Secret grafana-viewer"
REMOTE
