#!/usr/bin/env bash
# Build-11 check of the metrics stack, run from the operator's machine (needs `ssh k3s-leader`, the
# tailnet and node).
#   bash Infra/monitoring/check.sh
# Needs monitoring.yaml applied and settled (a minute after the first install). Changes nothing.
# It also calls the public Grafana address without a login. Part 1 asks Prometheus as the operator, part 2 acts as the platform server account through
# impersonation, part 3 calls the leader's Tailscale address with the real token (never printed).
set -u
cd "$(dirname "$0")"
k() { ssh k3s-leader "sudo -n k3s kubectl $*"; }
ks() { k --as=system:serviceaccount:platform:platform-server "$@"; }
fail=0
PROM=/api/v1/namespaces/monitoring/services/monitoring-prometheus:9090/proxy
# Every character outside [A-Za-z0-9] is percent-encoded, so the query survives the remote shell. It goes
# to node on stdin: Windows drops the double quotes of an argument.
enc() { printf '%s' "$1" | node -e 'let d = ""; process.stdin.on("data", (c) => (d += c)).on("end", () => process.stdout.write([...Buffer.from(d)].map((b) => (/[A-Za-z0-9]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : "%" + b.toString(16).padStart(2, "0"))).join("")))'; }
# value <PromQL>: the first sample's value, or nothing when the result is empty or the call failed.
value() {
  k get --raw "$PROM/api/v1/query?query=$(enc "$1")" 2>/dev/null | node -e '
    let d = ""; process.stdin.on("data", (c) => (d += c)).on("end", () => {
      try { const r = JSON.parse(d).data.result; if (r.length) process.stdout.write(String(r[0].value[1])) } catch {}
    })'
}
want() { # want <label> <expected> <PromQL>
  local got; got=$(value "$3")
  if [ "$got" = "$2" ]; then echo "PASS $1 ($got)"; else echo "FAIL $1: got '${got:-nothing}', want $2"; fail=1; fi
}
status() { if [ "$3" = "$1" ]; then echo "PASS $2 ($3)"; else echo "FAIL $2 (want $1, got $3)"; fail=1; fi; }
allow() { # allow <label> <command...>
  local label=$1 out; shift
  if out=$("$@" 2>&1); then echo "PASS $label"; else echo "FAIL $label: $(echo "$out" | head -1)"; fail=1; fi
}
deny() { # deny <label> <command...>: refused by RBAC
  local label=$1 out; shift
  if out=$("$@" 2>&1); then echo "FAIL $label accepted"; fail=1
  elif echo "$out" | grep -Eq 'cannot .* (resource|at the cluster scope)|Forbidden'; then echo "PASS $label refused"
  else echo "FAIL $label refused for another reason: $(echo "$out" | head -1)"; fail=1; fi
}

echo "== where it runs"
off=$(k -n monitoring get pods -o "jsonpath='{range .items[*]}{.metadata.name} {.spec.nodeName}{\"\\n\"}{end}'" | grep -v node-exporter | grep -vc ' k3s-leader$')
if [ "$off" = 0 ]; then echo "PASS everything but node-exporter is on the leader"; else echo "FAIL $off Pods are off the leader"; fail=1; fi
keep=$(k -n monitoring get prometheus monitoring-prometheus -o "jsonpath='{.spec.retention} {.spec.retentionSize} {.spec.enableAdminAPI}'")
if [ "$keep" = "14d 20GB false" ]; then echo "PASS retention 14d, size cap 20GB, admin API off"; else echo "FAIL retention settings: '$keep'"; fail=1; fi

ready() { # ready <label> <kind/name>: exists and every replica is Ready
  local got; got=$(k -n monitoring get "$2" -o "jsonpath='{.status.readyReplicas}/{.spec.replicas}'" 2>/dev/null)
  if [ "$got" = 1/1 ]; then echo "PASS $1 is Ready"; else echo "FAIL $1: ready/replicas '$got'"; fail=1; fi
}
ready Grafana deployment/monitoring-grafana
ready "the operator" deployment/monitoring-operator
ready kube-state-metrics deployment/monitoring-kube-state-metrics
ready Prometheus statefulset/prometheus-monitoring-prometheus
want_exporters=$(k -n monitoring get daemonset monitoring-prometheus-node-exporter -o "jsonpath='{.status.numberReady}'" 2>/dev/null)
if [ "$want_exporters" = 3 ]; then echo "PASS node-exporter is Ready on three nodes"; else echo "FAIL node-exporter ready on '$want_exporters' nodes"; fail=1; fi

echo "== who can reach it"
# From a Pod of another namespace (the local model's, which has python and no egress rule). A blocked
# call ends in python's "Connection refused" (the policy engine rejects, it does not drop) or a timeout;
# any other ending (a status, a missing Pod) is a failure.
reach() { k -n vllm exec deploy/vllm -- python3 -c "\"import urllib.request as u;print(u.urlopen('$1',timeout=5).status)\"" 2>&1; }
blocked() { # blocked <label> <url>
  local got; got=$(reach "$2")
  if echo "$got" | grep -Eq 'Connection refused|timed out|TimeoutError'; then echo "PASS $1 is out of reach from another namespace"; else echo "FAIL $1 from another namespace: $(echo "$got" | tail -1)"; fail=1; fi
}
blocked Prometheus http://monitoring-prometheus.monitoring.svc.cluster.local:9090/-/ready
blocked Grafana http://monitoring-grafana.monitoring.svc.cluster.local/api/health

echo "== public address (Grafana only)"
# Grafana is reachable through the tunnel so the operator page can embed it. Dashboards and the API
# need a login; the login page and /api/health do not.
G=https://grafana.stairnoworks.com
code() { curl -s -o /dev/null -m 15 -w '%{http_code}' "$1"; }
status 200 "the login page is served" "$(code $G/login)"
status 302 "a dashboard address without a login goes to the login page" "$(code $G/d/none)"
status 401 "the API without a login" "$(code $G/api/search)"
status 401 "Prometheus through Grafana without a login" "$(code "$G/api/datasources/proxy/1/api/v1/query?query=up")"
status 302 "Grafana's own /metrics is not served" "$(code $G/metrics)"
# Framing: answered at all, no X-Frame-Options (allow_embedding), and only the platform's page may frame.
head=$(curl -s -m 15 -D - -o /dev/null $G/login | tr -d '\r')
if ! echo "$head" | grep -q '^HTTP/[0-9.]* 200'; then echo "FAIL framing headers: no answer from $G/login"; fail=1
elif echo "$head" | grep -qi '^x-frame-options'; then echo "FAIL the login page forbids framing (allow_embedding is off)"; fail=1
elif ! echo "$head" | grep -qi "^content-security-policy: frame-ancestors 'self' https://app.stairnoworks.com$"; then echo "FAIL any site may frame Grafana (no frame-ancestors header)"; fail=1
else echo "PASS only the platform's page may frame Grafana"; fi
# The one way in from outside the namespace: Traefik's Pods to Grafana's web port, nothing wider.
np=$(k -n monitoring get networkpolicy -o "jsonpath='{range .items[*]}{.metadata.name}:{.spec.podSelector.matchLabels.app\.kubernetes\.io/name}:{.spec.ingress[*].ports[*].port}:{.spec.ingress[*].from[*].podSelector.matchLabels.app\.kubernetes\.io/name} {end}'")
if [ "$np" = "grafana-from-traefik:grafana:3000:traefik same-namespace-only::: " ]; then echo "PASS only Traefik reaches in, and only Grafana's port 3000"; else echo "FAIL NetworkPolicies of the namespace: '$np'"; fail=1; fi
# The view-only account of the operator page (make-viewer.sh). Its password goes to curl on stdin.
viewer() { # viewer <method> <path> [body] -> HTTP status
  k -n monitoring get secret grafana-viewer -o "jsonpath='{.data.password}'" 2>/dev/null | base64 --decode |
    { read -r pw || true; printf 'user = "viewer:%s"\n' "$pw"; } |
    curl -s -K - -o /dev/null -m 15 -w '%{http_code}' -X "$1" ${3:+-H 'Content-Type: application/json' -d "$3"} "$G$2"
}
status 200 "the view-only account reads dashboards" "$(viewer GET /api/search)"
status 403 "the view-only account cannot save a dashboard" "$(viewer POST /api/dashboards/db '{"dashboard":{"title":"check"}}')"
status 403 "the view-only account cannot read Grafana's settings" "$(viewer GET /api/admin/settings)"
status 404 "Prometheus has no public address" "$(code https://prometheus.stairnoworks.com/-/ready)"

echo "== what is collected"
want "node-exporter on the three nodes" 3 'count(up{job="node-exporter"} == 1)'
want "kubelet on the three nodes" 3 'count(up{job="kubelet",metrics_path="/metrics"} == 1)'
want "Pod usage (cAdvisor) from the three nodes" 3 'count(up{job="kubelet",metrics_path="/metrics/cadvisor"} == 1)'
want "kube-state-metrics" 1 'count(up{job="kube-state-metrics"} == 1)'
want "three nodes Ready" 3 'sum(kube_node_status_condition{condition="Ready",status="true"})'
want "Traefik on both workers" 2 'count(up{job="monitoring/traefik"} == 1)'
want "cloudflared" 1 'count(up{job="monitoring/cloudflared"} == 1)'
want "no target is down" "" 'count(up == 0)'
want "disk free is known for the three nodes" 3 'count(node_filesystem_avail_bytes{mountpoint="/",fstype!="tmpfs"})'
want "restart count of the demo app is known" 1 'count(sum(kube_pod_container_status_restarts_total{namespace="proj-demo"}))'

echo "== server account"
Q="$PROM/api/v1/query?query=$(enc 'sum(kube_node_status_condition{condition="Ready",status="true"})')"
allow "query Prometheus through the service proxy" ks get --raw "$Q"
deny "Grafana through the proxy" ks get --raw /api/v1/namespaces/monitoring/services/monitoring-grafana:80/proxy/api/health
deny "Prometheus through its other Service" ks get --raw /api/v1/namespaces/monitoring/services/prometheus-operated:9090/proxy/api/v1/query?query=up
deny "Prometheus Pod proxy" ks get --raw /api/v1/namespaces/monitoring/pods/prometheus-monitoring-prometheus-0:9090/proxy/api/v1/query?query=up
deny "read Services in monitoring" ks -n monitoring get services
deny "read Pods in monitoring" ks -n monitoring get pods
deny "read Secrets in monitoring" ks -n monitoring get secrets
deny "service proxy in another namespace (vllm)" ks get --raw /api/v1/namespaces/vllm/services/vllm:8000/proxy/health

echo "== real token over the tailnet"
TS=$(ssh k3s-leader 'tailscale ip -4')
CA=$(mktemp); trap 'rm -f "$CA"' EXIT
k -n platform get secret platform-server-token -o "jsonpath='{.data.ca\.crt}'" | base64 --decode > "$CA"
TOKEN=$(k -n platform get secret platform-server-token -o "jsonpath='{.data.token}'" | base64 --decode)
api() { # api <method> <path> -> HTTP status. The token goes to curl on stdin, not as an argument.
  printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" | curl -s --ssl-no-revoke -K - -o /dev/null -m 10 -w '%{http_code}' --cacert "$CA" -X "$1" "https://$TS:6443$2"
}
status 200 "query Prometheus" "$(api GET "$Q")"
status 403 "query by POST (the right is GET only)" "$(api POST "$Q")"
status 403 "Grafana through the proxy" "$(api GET /api/v1/namespaces/monitoring/services/monitoring-grafana:80/proxy/api/health)"
unset TOKEN

[ $fail = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
