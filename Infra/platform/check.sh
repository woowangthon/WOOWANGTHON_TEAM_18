#!/usr/bin/env bash
# Build-09 check of the platform server account, run from the operator's machine (needs `ssh k3s-leader`
# and the tailnet).
#   bash Infra/platform/check.sh
# Needs account.yaml, the student-template namespace and policies.yaml applied (see policies.yaml).
# Part 1 acts as the account through impersonation, part 2 checks the student Pod rule as the operator,
# part 3 calls the leader's Tailscale address with the real token (kept in a shell variable, never printed).
# Creates proj-srvcheck and proj-srvcheck2 and deletes them at the end, also when it stops early.
# Requests that must be refused and aim at real objects (vllm, student-template, kube-system, platform)
# are sent as server dry runs: admission still decides, but nothing changes if a policy is off.
set -u
cd "$(dirname "$0")"
k() { ssh k3s-leader "sudo -n k3s kubectl $*"; }
ks() { k --as=system:serviceaccount:platform:platform-server "$@"; }
fail=0
allow() { # allow <label> <command...>   stdin = manifest
  local label=$1 out; shift
  if out=$("$@" 2>&1); then echo "PASS $label"; else echo "FAIL $label: $(echo "$out" | head -1)"; fail=1; fi
}
deny() { # deny <rbac|policy|exists|escalation|builtin> <label> <command...>   stdin = manifest
  local why=$1 label=$2 out pat; shift 2
  case $why in
    rbac) pat='cannot .* (resource|at the cluster scope)';;
    policy) pat='ValidatingAdmissionPolicy';;
    exists) pat='AlreadyExists';;
    escalation) pat='not currently held|ValidatingAdmissionPolicy';; # RBAC refuses to bind a role the account may not bind
    builtin) pat='may not be deleted';; # Kubernetes itself protects kube-system, before any policy runs
  esac
  if out=$("$@" 2>&1); then echo "FAIL $label accepted"; fail=1
  elif echo "$out" | grep -Eq "$pat"; then echo "PASS $label refused ($why)"
  else echo "FAIL $label refused for another reason: $(echo "$out" | head -1)"; fail=1; fi
}
space() { sed "s/proj-demo/$1/g" ../student/space.yaml; }
doc() { # doc <Kind> <namespace> [file] [name]: one document of the template, renamed
  sed "s/proj-demo/$2/g" "${3:-../student/space.yaml}" | awk -v k="kind: $1" -v n="  name: ${4:-}" '
    function flush() { if (hit && (n == "  name: " || named)) printf "%s", buf; buf = ""; hit = 0; named = 0 }
    /^---$/ { flush(); next }
    { buf = buf $0 "\n"; if (index($0, k) == 1) hit = 1; if ($0 == n) named = 1 }
    END { flush() }'
}
ns() { # ns <name> [label=value ...]
  local name=$1; shift
  printf 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: %s\n  labels:\n' "$name"
  for l in "$@"; do printf '    %s: %s\n' "${l%%=*}" "${l#*=}"; done
}
secret() { # secret <namespace> <name> <type> <value>
  printf 'apiVersion: v1\nkind: Secret\nmetadata: {name: %s, namespace: %s}\ntype: %s\nstringData: {DATABASE_URL: "%s"}\n' "$2" "$1" "$3" "$4"
}
pod() { # pod <automount true|false> <drop capability> [extra pod spec line]
  cat <<EOF
apiVersion: v1
kind: Pod
metadata: {name: policy-check, namespace: proj-demo}
spec:
  automountServiceAccountToken: $1
  ${3:-terminationGracePeriodSeconds: 1}
  containers:
  - name: c
    image: busybox:1.37
    securityContext: {capabilities: {drop: ["$2"]}}
EOF
}
BASE="pod-security.kubernetes.io/enforce=baseline pod-security.kubernetes.io/warn=restricted"

cleanup() { k delete namespace proj-srvcheck proj-srvcheck2 --ignore-not-found --wait=false >/dev/null; }
trap cleanup EXIT
k delete namespace proj-srvcheck proj-srvcheck2 --ignore-not-found >/dev/null

echo "== server account: what #81 and #43 do"
allow "create a space from the template (6 objects)" ks create -f - < <(space proj-srvcheck)
deny exists "create the same space again" ks create -f - < <(space proj-srvcheck)
allow "create a Secret" ks create -f - < <(secret proj-srvcheck be-secrets Opaque first)
allow "replace the Secret (PUT)" ks replace -f - < <(secret proj-srvcheck be-secrets Opaque second)
allow "create an empty second space" ks create -f - < <(ns proj-srvcheck2 $BASE)

echo "== server account: spaces"
deny policy "namespace without the proj- prefix" ks create -f - < <(ns other-space $BASE)
deny policy "space without labels" ks create -f - < <(printf 'apiVersion: v1\nkind: Namespace\nmetadata: {name: proj-srvcheck3}\n')
deny policy "space with enforce=privileged" ks create -f - < <(ns proj-srvcheck3 pod-security.kubernetes.io/enforce=privileged pod-security.kubernetes.io/warn=restricted)
deny policy "space with an extra label" ks create -f - < <(ns proj-srvcheck3 $BASE wanggane/pool=student)
deny builtin "delete kube-system" ks delete namespace kube-system --dry-run=server
deny policy "delete vllm" ks delete namespace vllm --dry-run=server
deny policy "delete student-template" ks delete namespace student-template --dry-run=server
deny rbac "relabel a space" ks patch namespace proj-srvcheck --type=merge -p "'{\"metadata\":{\"labels\":{\"pod-security.kubernetes.io/enforce\":\"privileged\"}}}'"
deny rbac "list namespaces" ks get namespaces

echo "== server account: cap, defaults, isolation (in the empty second space)"
deny policy "ResourceQuota with another value" ks create -f - < <(doc ResourceQuota proj-srvcheck2 | sed 's/limits.cpu: "8"/limits.cpu: "80"/')
deny policy "LimitRange with another value" ks create -f - < <(doc LimitRange proj-srvcheck2 | sed 's/memory: 4Gi/memory: 64Gi/')
deny policy "NetworkPolicy without the private-range block" ks create -f - < <(doc NetworkPolicy proj-srvcheck2 | sed '/- 10\.0\.0\.0\/8/d')
deny policy "second NetworkPolicy under another name" ks create -f - < <(doc NetworkPolicy proj-srvcheck2 | sed 's/name: project-isolation/name: allow-more/')
deny rbac "delete the ResourceQuota" ks -n proj-srvcheck delete resourcequota project-cap
deny rbac "delete the NetworkPolicy" ks -n proj-srvcheck delete networkpolicy project-isolation
deny policy "read binding under another name" ks create -f - < <(doc RoleBinding proj-srvcheck2 '' platform-server-read | sed 's/name: platform-server-read/name: more-read/')
deny policy "read binding for another account" ks create -f - < <(printf 'apiVersion: rbac.authorization.k8s.io/v1\nkind: RoleBinding\nmetadata: {name: platform-server-read, namespace: proj-srvcheck2}\nroleRef: {apiGroup: rbac.authorization.k8s.io, kind: ClusterRole, name: proj-reader}\nsubjects: [{kind: ServiceAccount, name: default, namespace: proj-srvcheck2}]\n')
deny escalation "binding to cluster-admin" ks create -f - < <(printf 'apiVersion: rbac.authorization.k8s.io/v1\nkind: RoleBinding\nmetadata: {name: platform-server-read, namespace: proj-srvcheck2}\nroleRef: {apiGroup: rbac.authorization.k8s.io, kind: ClusterRole, name: cluster-admin}\nsubjects: [{kind: ServiceAccount, name: platform-server, namespace: platform}]\n')
deny rbac "delete the read binding" ks -n proj-srvcheck delete rolebinding platform-server-read
deny policy "executor binding to the read role" ks create -f - < <(doc RoleBinding proj-srvcheck2 '' deploy-executor | sed 's/name: proj-deployer/name: proj-reader/')
deny policy "executor role under another binding name" ks create -f - < <(doc RoleBinding proj-srvcheck2 '' deploy-executor | sed 's/^  name: deploy-executor$/  name: more-deploy/')
deny policy "executor binding for another account" ks create -f - < <(printf 'apiVersion: rbac.authorization.k8s.io/v1\nkind: RoleBinding\nmetadata: {name: deploy-executor, namespace: proj-srvcheck2}\nroleRef: {apiGroup: rbac.authorization.k8s.io, kind: ClusterRole, name: proj-deployer}\nsubjects: [{kind: ServiceAccount, name: platform-server, namespace: platform}]\n')
allow "executor binding from the template" ks create -f - < <(doc RoleBinding proj-srvcheck2 '' deploy-executor)
deny rbac "delete the executor binding" ks -n proj-srvcheck delete rolebinding deploy-executor
deny rbac "patch the ResourceQuota" ks -n proj-srvcheck patch resourcequota project-cap --type=merge -p "'{\"spec\":{\"hard\":{\"pods\":\"100\"}}}'"

echo "== server account: Secrets"
deny rbac "read a Secret" ks -n proj-srvcheck get secret be-secrets
deny rbac "list Secrets" ks -n proj-srvcheck get secrets
deny rbac "patch a Secret" ks -n proj-srvcheck patch secret be-secrets --type=merge -p "'{}'"
deny rbac "delete a Secret" ks -n proj-srvcheck delete secret be-secrets
deny policy "Secret with another name" ks create -f - < <(secret proj-srvcheck be-config Opaque x)
deny policy "service-account-token Secret" ks create -f - < <(printf 'apiVersion: v1\nkind: Secret\nmetadata: {name: sa-secrets, namespace: proj-srvcheck, annotations: {kubernetes.io/service-account.name: default}}\ntype: kubernetes.io/service-account-token\n')
deny policy "Secret outside proj- (vllm)" ks create --dry-run=server -f - < <(secret vllm be-secrets Opaque x)
deny policy "Secret outside proj- (platform)" ks create --dry-run=server -f - < <(secret platform be-secrets Opaque x)
deny policy "replace the vLLM key" ks replace --dry-run=server -f - < <(secret vllm vllm-api-key Opaque x | sed 's/DATABASE_URL/api-key/')

echo "== server account: everything else"
deny rbac "create a Pod in a space" ks create -f - < <(pod false NET_RAW | sed 's/proj-demo/proj-srvcheck/')
deny rbac "create a Deployment in a space" ks -n proj-srvcheck create deployment x --image=busybox:1.37
deny rbac "create a Middleware in a space" ks create -f - < <(printf 'apiVersion: traefik.io/v1alpha1\nkind: Middleware\nmetadata: {name: x, namespace: proj-srvcheck}\nspec: {stripPrefix: {prefixes: ["/a"]}}\n')

echo "== server account: stop a service (scale to 0, through the read binding of each space)"
SCALE0="'{\"spec\":{\"replicas\":0}}'"
SCALE1="'{\"spec\":{\"replicas\":1}}'"
allow "operator puts a Deployment in the own space" k create -f - < <(doc Deployment proj-srvcheck ../student/app-example.yaml)
allow "scale it to 0" ks -n proj-srvcheck patch deployment web --subresource=scale --type=merge -p "$SCALE0"
replicas=$(k -n proj-srvcheck get deployment web -o "jsonpath='{.spec.replicas}'")
if [ "$replicas" = 0 ]; then echo "PASS the Deployment is at 0"; else echo "FAIL replicas after the stop: '$replicas'"; fail=1; fi
allow "scale it to 0 again (already stopped)" ks -n proj-srvcheck patch deployment web --subresource=scale --type=merge -p "$SCALE0"
deny policy "scale it back to 1" ks -n proj-srvcheck patch deployment web --subresource=scale --type=merge -p "$SCALE1"
allow "scale proj-demo to 0 (dry run)" ks -n proj-demo patch deployment web --subresource=scale --type=merge -p "$SCALE0" --dry-run=server
deny policy "scale proj-demo to 2 (dry run)" ks -n proj-demo patch deployment web --subresource=scale --type=merge -p "'{\"spec\":{\"replicas\":2}}'" --dry-run=server
deny rbac "patch the Deployment itself" ks -n proj-srvcheck patch deployment web --type=merge -p "$SCALE0"
deny rbac "scale in vllm" ks -n vllm patch deployment vllm --subresource=scale --type=merge -p "$SCALE0" --dry-run=server
deny rbac "scale in kube-system" ks -n kube-system patch deployment coredns --subresource=scale --type=merge -p "$SCALE0" --dry-run=server
deny rbac "scale in a space without the read binding" ks -n proj-srvcheck2 patch deployment web --subresource=scale --type=merge -p "$SCALE0"

echo "== server account: reads (through the read binding of each space)"
allow "read Pods in an own space" ks -n proj-srvcheck get pods
allow "read Pods in proj-demo" ks -n proj-demo get pods
allow "read a Pod log in proj-demo" ks -n proj-demo logs -l app=web --tail=1
allow "read Deployments in proj-demo" ks -n proj-demo get deployments
allow "read events in proj-demo" ks -n proj-demo get events
allow "read Ingresses in proj-demo" ks -n proj-demo get ingresses
deny rbac "read events in kube-system" ks -n kube-system get events
deny rbac "read Ingresses in vllm" ks -n vllm get ingresses
allow "read nodes" ks get nodes
deny rbac "read Pods in kube-system" ks -n kube-system get pods
deny rbac "read Pods in vllm" ks -n vllm get pods
deny rbac "read a log in vllm" ks -n vllm logs -l app=vllm --tail=1
deny rbac "read Pods in every namespace" ks get pods -A
deny rbac "read Pods in a space without the binding" ks -n proj-srvcheck2 get pods
deny rbac "read Secrets in proj-demo" ks -n proj-demo get secrets
deny rbac "read ConfigMaps in proj-demo" ks -n proj-demo get configmaps
deny rbac "exec into a Pod" ks -n proj-demo exec deploy/web -- true
allow "delete an own space" ks delete namespace proj-srvcheck2 --wait=false

echo "== student Pod rule (as the operator, server dry run)"
allow "Pod with no token and NET_RAW dropped" k create --dry-run=server -f - < <(pod false NET_RAW)
allow "Pod with no token and ALL dropped" k create --dry-run=server -f - < <(pod false ALL)
deny policy "Pod with the API token" k create --dry-run=server -f - < <(pod true NET_RAW)
deny policy "Pod keeping NET_RAW" k create --dry-run=server -f - < <(pod false CHOWN)
deny policy "Pod with a projected API token volume" k create --dry-run=server -f - < <(pod false NET_RAW 'volumes: [{name: t, projected: {sources: [{serviceAccountToken: {path: token}}]}}]')
deny policy "Deployment with the API token" k create --dry-run=server -f - < <(doc Deployment proj-demo ../student/app-example.yaml | sed 's/name: web$/name: web-check/; s/automountServiceAccountToken: false/automountServiceAccountToken: true/')
running=$(k -n proj-demo get deployment web -o "jsonpath='{.status.readyReplicas}'")
if [ "$running" = 1 ]; then echo "PASS proj-demo web still running"; else echo "FAIL proj-demo web ready replicas: '$running'"; fail=1; fi

echo "== real token over the tailnet"
TS=$(ssh k3s-leader 'tailscale ip -4')
CA=$(mktemp); trap 'rm -f "$CA"; cleanup' EXIT
k -n platform get secret platform-server-token -o "jsonpath='{.data.ca\.crt}'" | base64 --decode > "$CA"
TOKEN=$(k -n platform get secret platform-server-token -o "jsonpath='{.data.token}'" | base64 --decode)
api() { # api <token> <method> <path> [json body] [content type] -> HTTP status
  # --ssl-no-revoke: Windows curl (Schannel) asks for a revocation list, which a cluster CA does not have.
  # The token goes to curl on stdin (-K -), not as an argument, so it does not show in the process list.
  printf 'header = "Authorization: Bearer %s"\n' "$1" | curl -s --ssl-no-revoke -K - -o /dev/null -m 10 -w '%{http_code}' --cacert "$CA" -H "Content-Type: ${5:-application/json}" -X "$2" ${4:+-d "$4"} "https://$TS:6443$3"
}
status() { # status <want> <label> <got>
  if [ "$3" = "$1" ]; then echo "PASS $2 ($3)"; else echo "FAIL $2 (want $1, got $3)"; fail=1; fi
}
NSJSON='{"apiVersion":"v1","kind":"Namespace","metadata":{"name":"%s","labels":{"pod-security.kubernetes.io/enforce":"baseline","pod-security.kubernetes.io/warn":"restricted"}}}'
status 201 "create a space (dry run)"        "$(api "$TOKEN" POST '/api/v1/namespaces?dryRun=All' "$(printf "$NSJSON" proj-srvcheck4)")"
status 409 "create an existing space"        "$(api "$TOKEN" POST '/api/v1/namespaces' "$(printf "$NSJSON" proj-srvcheck)")"
status 422 "space without the proj- prefix"  "$(api "$TOKEN" POST '/api/v1/namespaces?dryRun=All' "$(printf "$NSJSON" other-space)")"
status 403 "read Secrets"                    "$(api "$TOKEN" GET '/api/v1/namespaces/proj-srvcheck/secrets')"
MERGE=application/merge-patch+json
status 200 "stop proj-demo web (dry run)"    "$(api "$TOKEN" PATCH '/apis/apps/v1/namespaces/proj-demo/deployments/web/scale?dryRun=All' '{"spec":{"replicas":0}}' $MERGE)"
status 422 "scale proj-demo web to 1 (dry run)" "$(api "$TOKEN" PATCH '/apis/apps/v1/namespaces/proj-demo/deployments/web/scale?dryRun=All' '{"spec":{"replicas":1}}' $MERGE)"
status 403 "stop a Deployment in vllm"       "$(api "$TOKEN" PATCH '/apis/apps/v1/namespaces/vllm/deployments/vllm/scale?dryRun=All' '{"spec":{"replicas":0}}' $MERGE)"
status 401 "wrong token"                     "$(api not-a-token GET '/api/v1/namespaces')"
unset TOKEN

echo "== cleanup"
[ $fail = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
