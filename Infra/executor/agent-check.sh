#!/usr/bin/env bash
# Build-09′ check of the executor Pod's shape without a GoCD server, run from the operator's machine
# (needs `ssh k3s-leader`, the tailnet and node).
#   bash Infra/executor/agent-check.sh
# Starts one Pod built from the Pod template in agent.yaml (same node, account, security settings,
# tool init containers and env) with a test command in place of the agent, under the NetworkPolicy from
# the same file, then deletes the Pod. The policy is deleted too unless it was there before.
# It does not register anything: no Secret `gocd-agent` is needed.
set -u
cd "$(dirname "$0")"
k() { ssh k3s-leader "sudo -n k3s kubectl $*"; }
fail=0
POD=executor-agent-check

# What the Pod runs. One `name=value` line per fact; the expectations are below.
read -r -d '' PROBE <<'EOF'
code() { curl -s -o /dev/null -m 6 -w '%{http_code}' "$@"; }
api() { code --cacert "$KUBE_CA_FILE" -H "Authorization: Bearer $(cat "$KUBE_TOKEN_FILE")" "$KUBE_API_URL$1"; }
echo "node=$(node --version)"
echo "helm=$(helm version --short)"
echo "git=$(git --version)"
echo "user=$(id -u)"
echo "api_deployments=$(api /apis/apps/v1/namespaces/proj-demo/deployments)"
echo "api_secrets=$(api /api/v1/namespaces/proj-demo/secrets)"
echo "api_kube_system=$(api /api/v1/namespaces/kube-system/pods)"
echo "traefik=$(code -H 'Host: demo.stairnoworks.com' http://traefik.kube-system.svc.cluster.local/)"
echo "internet=$(code https://github.com/)"
echo "image_cache=$(code http://192.168.77.11:5000/v2/)"
echo "local_model=$(code http://vllm.vllm.svc.cluster.local:8000/health)"
echo "kubelet=$(code -k https://192.168.77.12:10250/healthz)"
echo "internet_http=$(code http://github.com/)"
EOF

had_policy=$(k -n deploy get networkpolicy executor-only --ignore-not-found -o name)
cleanup() {
  k -n deploy delete pod $POD --ignore-not-found --wait=false >/dev/null
  [ -n "$had_policy" ] || k -n deploy delete networkpolicy executor-only --ignore-not-found >/dev/null
}
trap cleanup EXIT
k -n deploy delete pod $POD --ignore-not-found >/dev/null

echo "== manifest"
if out=$(k apply --dry-run=server -f - < agent.yaml 2>&1); then echo "PASS agent.yaml passes a server dry run"; else echo "FAIL server dry run: $(echo "$out" | head -1)"; fail=1; fi

echo "== check Pod from the same template"
k create --dry-run=client -o json -f - < agent.yaml | PROBE="$PROBE" POD=$POD node -e '
  let d = ""; process.stdin.on("data", (c) => (d += c)).on("end", () => {
    // kubectl prints the two objects one after the other, not as a list.
    const items = d.split(/\n(?=\{\n)/).map((o) => JSON.parse(o))
    const policy = items.find((o) => o.kind === "NetworkPolicy")
    const spec = items.find((o) => o.kind === "Deployment").spec.template.spec
    const agent = spec.containers[0]
    delete agent.envFrom
    agent.command = ["bash", "-c", process.env.PROBE]
    // The policy selects every Pod in the namespace, so the check Pod is under it as the agent will be.
    const pod = { apiVersion: "v1", kind: "Pod", metadata: { name: process.env.POD, namespace: "deploy" }, spec: { ...spec, restartPolicy: "Never" } }
    console.log(JSON.stringify({ apiVersion: "v1", kind: "List", items: [policy, pod] }))
  })' | k apply -f - >/dev/null || { echo "FAIL could not create the check Pod"; exit 1; }

phase=
for _ in $(seq 60); do
  phase=$(k -n deploy get pod $POD -o "jsonpath='{.status.phase}'")
  [ "$phase" = Succeeded ] || [ "$phase" = Failed ] && break
  sleep 3
done
if [ "$phase" != Succeeded ]; then
  echo "FAIL the check Pod ended as '$phase'"
  k -n deploy get pod $POD -o wide; k -n deploy logs $POD --all-containers --tail=20
  exit 1
fi
facts=$(k -n deploy logs $POD -c agent)
node_on=$(k -n deploy get pod $POD -o "jsonpath='{.spec.nodeName}'")

want() { # want <name> <extended regex> <label>
  local got; got=$(echo "$facts" | sed -n "s/^$1=//p")
  if echo "$got" | grep -Eq "^($2)$"; then echo "PASS $3 ($got)"; else echo "FAIL $3: got '$got'"; fail=1; fi
}
if [ "$node_on" = k3s-leader ]; then echo "PASS runs on the leader"; else echo "FAIL runs on '$node_on'"; fail=1; fi
echo "== tools"
want node 'v24\.[0-9.]+' "node from the tool volume"
want helm 'v3\.[0-9.]+.*' "helm from the tool volume"
want git 'git version .+' "git in the agent image"
want user '1000' "not root"
echo "== allowed"
want api_deployments 200 "executor token reads Deployments in proj-demo"
want traefik 200 "request through Traefik (the Verify path)"
want internet '200|301|302' "HTTPS to a public address (git material)"
echo "== refused"
want api_secrets 403 "executor token cannot read Secrets"
want api_kube_system 403 "executor token cannot read kube-system"
want image_cache 000 "image cache is out of reach"
want local_model 000 "local model is out of reach"
want kubelet 000 "a worker's kubelet is out of reach"
want internet_http 000 "plain HTTP to a public address is out of reach"

[ $fail = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
