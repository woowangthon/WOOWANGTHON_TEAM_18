#!/usr/bin/env bash
# Build-09′ check of the leader deploy executor account, run from the operator's machine (needs
# `ssh k3s-leader`).
#   bash Infra/executor/check.sh
# Needs Infra/platform/ and Infra/executor/ applied, and the student-template namespace brought up to
# Infra/student/space.yaml (see Infra/platform/policies.yaml).
# Part 1 acts as the account through impersonation in a space of its own, made from the template and
# deleted at the end, also when the script stops early. Its name is longer than a slug may be (40), so
# no student space has it; a name with two hyphens in a row would do too, but Traefik collapses those
# in a Middleware's name and the Ingress annotation below would point at nothing. It deploys the example app there for real, with its stripPrefix Middleware, and asks Traefik for
# it. Part 2 sends what must be refused; requests that aim at real objects are server dry runs.
# Part 3 checks the Pod rules as the operator.
set -u
cd "$(dirname "$0")"
NS=proj-check-of-the-deploy-executor-not-a-student-space
HOST=check.check.invalid
k() { ssh k3s-leader "sudo -n k3s kubectl $*"; }
ke() { k --as=system:serviceaccount:deploy:deploy-executor "$@"; }
fail=0
allow() { # allow <label> <command...>   stdin = manifest
  local label=$1 out; shift
  if out=$("$@" 2>&1); then echo "PASS $label"; else echo "FAIL $label: $(echo "$out" | head -1)"; fail=1; fi
}
deny() { # deny <rbac|policy> <label> <command...>   stdin = manifest
  local why=$1 label=$2 out pat; shift 2
  case $why in
    rbac) pat='cannot .* (resource|at the cluster scope)';;
    policy) pat='ValidatingAdmissionPolicy';;
  esac
  if out=$("$@" 2>&1); then echo "FAIL $label accepted"; fail=1
  elif echo "$out" | grep -Eq "$pat"; then echo "PASS $label refused ($why)"
  else echo "FAIL $label refused for another reason: $(echo "$out" | head -1)"; fail=1; fi
}
# The example app, moved to the check space and off the public host.
app() { sed "s/proj-demo/$NS/g; s/demo\.stairnoworks\.com/$HOST/" ../student/app-example.yaml; }
doc() { # doc <Kind>: one document of the example app
  app | awk -v k="kind: $1" '
    function flush() { if (hit) printf "%s", buf; buf = ""; hit = 0 }
    /^---$/ { flush(); next }
    { buf = buf $0 "\n"; if (index($0, k) == 1) hit = 1 }
    END { flush() }'
}
deployment() { # deployment <name> <extra pod spec line>
  doc Deployment | sed "s/^  name: web\$/  name: $1/; s/^      enableServiceLinks: false\$/      $2/"
}
middleware() { # middleware <namespace> <spec as flow YAML>
  printf 'apiVersion: traefik.io/v1alpha1\nkind: Middleware\nmetadata: {name: check, namespace: %s}\nspec: %s\n' "$1" "$2"
}
pod() { # pod <extra pod spec line>
  cat <<EOF
apiVersion: v1
kind: Pod
metadata: {name: policy-check, namespace: $NS}
spec:
  automountServiceAccountToken: false
  $1
  containers:
  - name: c
    image: busybox:1.37
    securityContext: {capabilities: {drop: ["NET_RAW"]}}
EOF
}
traefik() { # traefik <path> -> HTTP status, asked from the leader with the check host
  ssh k3s-leader "curl -s -o /dev/null -m 6 -w '%{http_code}' -H 'Host: $HOST' http://\$(sudo -n k3s kubectl -n kube-system get svc traefik -o jsonpath='{.spec.clusterIP}')$1"
}
status() { # status <want> <label> <path>: retried, Traefik needs a moment to pick up a change
  local got=000 i
  for i in 1 2 3 4 5 6; do got=$(traefik "$3"); [ "$got" = "$1" ] && break; sleep 2; done
  if [ "$got" = "$1" ]; then echo "PASS $2 ($got)"; else echo "FAIL $2 (want $1, got $got)"; fail=1; fi
}
LEADER='tolerations: [{key: node-role.kubernetes.io\/control-plane, operator: Exists, effect: NoSchedule}]'

cleanup() { k delete namespace $NS --ignore-not-found --wait=false >/dev/null; }
trap cleanup EXIT
k delete namespace $NS --ignore-not-found >/dev/null
sed "s/proj-demo/$NS/g" ../student/space.yaml | k create -f - >/dev/null || { echo "FAIL could not create $NS"; exit 1; }

echo "== executor account: a deploy (apply, wait, read, switch, clear)"
allow "server dry run of the app (Render)" ke apply --dry-run=server -f - < <(app)
allow "apply Deployment, Service, Middleware, Ingress" ke apply -f - < <(app)
allow "apply a ConfigMap" ke apply -f - < <(printf 'apiVersion: v1\nkind: ConfigMap\nmetadata: {name: web-config, namespace: %s, labels: {app: web}}\ndata: {PORT: "9898"}\n' $NS)
allow "wait for the rollout" ke -n $NS rollout status deployment/web --timeout=180s
allow "read Pods" ke -n $NS get pods
allow "read events" ke -n $NS get events
allow "read Endpoints" ke -n $NS get endpoints web
allow "read EndpointSlices" ke -n $NS get endpointslices
allow "read ReplicaSets" ke -n $NS get replicasets
allow "read the Ingress (live-slot check)" ke -n $NS get ingress web -o name
status 200 "Traefik reaches the app at /readyz" /readyz
status 200 "stripPrefix through Traefik: /svc/readyz" /svc/readyz
allow "change the Ingress (take the Middleware off)" ke -n $NS annotate ingress web traefik.ingress.kubernetes.io/router.middlewares-
status 404 "without the Middleware: /svc/readyz" /svc/readyz
allow "scale the Deployment to 0" ke -n $NS patch deployment web --type=merge -p "'{\"spec\":{\"replicas\":0}}'"
allow "delete the Middleware" ke -n $NS delete middleware web-strip
allow "clear by label (Deployment, ConfigMap)" ke -n $NS delete deployment,configmap -l app=web
allow "delete the Service and the Ingress" ke -n $NS delete service/web ingress/web

echo "== executor account: outside its spaces"
deny rbac "Deployment in kube-system" ke apply --dry-run=server -f - < <(doc Deployment | sed "s/$NS/kube-system/")
deny rbac "Deployment in vllm" ke apply --dry-run=server -f - < <(doc Deployment | sed "s/$NS/vllm/")
deny rbac "Middleware in kube-system" ke create --dry-run=server -f - < <(middleware kube-system '{stripPrefix: {prefixes: ["/svc"]}}')
deny rbac "read Pods in kube-system" ke -n kube-system get pods
deny rbac "read Pods in vllm" ke -n vllm get pods
deny rbac "read Pods in every namespace" ke get pods -A
deny rbac "read ConfigMaps in kube-system" ke -n kube-system get configmaps
deny rbac "read nodes" ke get nodes
# student-template holds the reference copy of the binding, so RBAC lets the account in there.
# The policy is what refuses the write.
deny policy "Deployment in student-template" ke create --dry-run=server -f - < <(doc Deployment | sed "s/$NS/student-template/")
deny policy "Middleware in student-template" ke create --dry-run=server -f - < <(middleware student-template '{stripPrefix: {prefixes: ["/svc"]}}')

echo "== executor account: inside a space, what it must not touch"
deny rbac "read Secrets" ke -n $NS get secrets
deny rbac "create a Secret" ke -n $NS create secret generic be-secrets --from-literal=a=b
deny rbac "read a Pod log" ke -n proj-demo logs -l app=web --tail=1
deny rbac "exec into a Pod" ke -n proj-demo exec deploy/web -- true
deny rbac "create a Pod directly" ke create -f - < <(pod 'terminationGracePeriodSeconds: 1')
deny rbac "create a namespace" ke create namespace proj-execcheck2
deny rbac "delete the space" ke delete namespace $NS
deny rbac "patch the ResourceQuota" ke -n $NS patch resourcequota project-cap --type=merge -p "'{\"spec\":{\"hard\":{\"pods\":\"100\"}}}'"
deny rbac "delete the LimitRange" ke -n $NS delete limitrange container-defaults
deny rbac "delete the NetworkPolicy" ke -n $NS delete networkpolicy project-isolation
deny rbac "create a NetworkPolicy" ke create -f - < <(printf 'apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata: {name: allow-more, namespace: %s}\nspec: {podSelector: {}, egress: [{}]}\n' $NS)
deny rbac "create a RoleBinding" ke -n $NS create rolebinding more --clusterrole=proj-deployer --serviceaccount=deploy:deploy-executor
deny rbac "delete its own binding" ke -n $NS delete rolebinding deploy-executor
deny rbac "create an IngressRoute" ke create -f - < <(printf 'apiVersion: traefik.io/v1alpha1\nkind: IngressRoute\nmetadata: {name: check, namespace: %s}\nspec: {routes: [{kind: Rule, match: "Host(`%s`)", services: [{name: web, port: 80}]}]}\n' $NS $HOST)

echo "== Middleware rule"
deny policy "redirectScheme Middleware" ke create -f - < <(middleware $NS '{redirectScheme: {scheme: https}}')
deny policy "forwardAuth Middleware" ke create -f - < <(middleware $NS '{forwardAuth: {address: "http://example.com"}}')
deny policy "plugin Middleware" ke create -f - < <(middleware $NS '{plugin: {x: {a: b}}}')
deny policy "stripPrefixRegex Middleware" ke create -f - < <(middleware $NS '{stripPrefixRegex: {regex: ["/.*"]}}')
deny policy "stripPrefix together with headers" ke create -f - < <(middleware $NS '{stripPrefix: {prefixes: ["/svc"]}, headers: {customRequestHeaders: {X-A: b}}}')
deny policy "Middleware with an empty spec" ke create -f - < <(middleware $NS '{}')
deny policy "redirect Middleware as the operator" k create -f - < <(middleware $NS '{redirectScheme: {scheme: https}}')
allow "stripPrefix Middleware (dry run)" ke create --dry-run=server -f - < <(middleware $NS '{stripPrefix: {prefixes: ["/svc"]}}')

echo "== Pod rules: toleration and nodeName"
deny policy "Deployment tolerating the leader taint" ke apply --dry-run=server -f - < <(deployment tol "$LEADER")
deny policy "Deployment tolerating everything" ke apply --dry-run=server -f - < <(deployment tol 'tolerations: [{operator: Exists}]')
deny policy "Deployment naming its node" ke apply --dry-run=server -f - < <(deployment pin 'nodeName: k3s-leader')
deny policy "Deployment with the API token" ke apply --dry-run=server -f - < <(deployment tok 'enableServiceLinks: false' | sed 's/automountServiceAccountToken: false/automountServiceAccountToken: true/')
allow "Deployment with none of these" ke apply --dry-run=server -f - < <(deployment plain 'enableServiceLinks: false')
allow "Pod with no toleration (operator)" k create --dry-run=server -f - < <(pod 'terminationGracePeriodSeconds: 1')
deny policy "Pod tolerating the leader taint (operator)" k create --dry-run=server -f - < <(pod "${LEADER//\\/}")
deny policy "Pod naming its node (operator)" k create --dry-run=server -f - < <(pod 'nodeName: k3s-leader')
running=$(k -n proj-demo get deployment web -o "jsonpath='{.status.readyReplicas}'")
if [ "$running" = 1 ]; then echo "PASS proj-demo web still running"; else echo "FAIL proj-demo web ready replicas: '$running'"; fail=1; fi

echo "== cleanup"
[ $fail = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
