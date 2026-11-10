#!/usr/bin/env bash
# Build-08 check of the student space template, run from the operator's machine (needs `ssh k3s-leader`).
#   bash Infra/student/check.sh
# Needs proj-demo from space.yaml + app-example.yaml. Creates a second space proj-check from the same
# template and a control namespace without the NetworkPolicy, probes from a test Pod in each, prints
# PASS/FAIL per line, then deletes everything it created (proj-demo is left as it was), also when it stops early.
# A TCP target counts as reached when curl's connect time is non-zero (telnet:// then waits for the timeout).
set -u
cd "$(dirname "$0")"
k() { ssh k3s-leader "sudo -n k3s kubectl $*"; }
fail=0
expect() { # expect <ok|blocked> <label> <result line "exit code time_connect">
  local want=$1 label=$2 e c t got
  read -r e c t <<<"$3"
  # Blocked means refused (7) or timed out (28) before connecting; any other curl error proves nothing.
  if [ "$e" = 0 ] || awk "BEGIN{exit !($t > 0)}"; then got=ok
  elif [ "$e" = 7 ] || [ "$e" = 28 ]; then got=blocked
  else got="error (curl exit $e)"; fi
  if [ "$got" = "$want" ]; then echo "PASS $label ($got)"; else echo "FAIL $label (want $want, got $got)"; fail=1; fi
}

# A Pod that passes the build-09 student Pod rule (no API token, NET_RAW dropped), plus the lines under test.
testpod() { # testpod <name> [pod spec line] [extra securityContext fields] [container line]
  cat <<EOF
apiVersion: v1
kind: Pod
metadata: {name: $1, namespace: proj-demo}
spec:
  automountServiceAccountToken: false
  restartPolicy: Never
  ${2:-terminationGracePeriodSeconds: 1}
  containers:
  - name: c
    image: busybox:1.37
    command: ["sleep", "60"]
    securityContext: {${3:+$3, }capabilities: {drop: ["NET_RAW"]}}
    ${4:-imagePullPolicy: IfNotPresent}
EOF
}

cleanup() {
  k delete namespace proj-check netpol-control --ignore-not-found --wait=false >/dev/null
  k -n proj-demo delete pod check-client pin-leader no-selector --ignore-not-found >/dev/null
}
trap cleanup EXIT
# Leftovers from a run that was cut off.
k delete namespace proj-check netpol-control --ignore-not-found >/dev/null
k -n proj-demo delete pod check-client pin-leader no-selector --ignore-not-found >/dev/null

TS=$(ssh k3s-leader 'tailscale ip -4')
{ sed 's/proj-demo/proj-check/g' space.yaml; echo '---'; sed 's/proj-demo/proj-check/g' app-example.yaml; } | k apply -f - >/dev/null 2>&1
k create namespace netpol-control >/dev/null
k label namespace netpol-control pod-security.kubernetes.io/enforce=baseline >/dev/null
for ns in proj-demo proj-check netpol-control; do
  until k -n $ns get serviceaccount default >/dev/null 2>&1; do sleep 1; done
  k apply -f - >/dev/null <<EOF
apiVersion: v1
kind: Pod
metadata: {name: check-client, namespace: $ns}
spec:
  nodeSelector: {wanggane/pool: student}
  automountServiceAccountToken: false
  terminationGracePeriodSeconds: 1
  containers:
  - name: c
    image: docker.io/curlimages/curl:8.11.1
    command: ["sleep", "600"]
    resources: {requests: {cpu: 50m, memory: 32Mi}, limits: {cpu: 500m, memory: 128Mi}}
    securityContext: {allowPrivilegeEscalation: false, capabilities: {drop: ["ALL"]}, runAsNonRoot: true, runAsUser: 100, seccompProfile: {type: RuntimeDefault}}
EOF
done
k -n proj-check rollout status deployment/web --timeout=180s >/dev/null
for ns in proj-demo proj-check netpol-control; do k -n $ns wait --for=condition=Ready pod/check-client --timeout=180s >/dev/null; done
CHECKIP=$(k -n proj-check get pod -l app=web -o "jsonpath='{.items[0].status.podIP}'")

probe() { # probe <namespace> <url>
  k -n "$1" exec check-client -- curl -sk -o /dev/null --connect-timeout 4 -m 6 -w "'%{exitcode} %{http_code} %{time_connect}'" "'$2'" </dev/null 2>/dev/null
}
run() { # run <namespace> <ok|blocked> <label> <url>
  local out; out=$(probe "$1" "$4")
  # No output means kubectl exec itself failed (no client Pod), which proves nothing either way.
  if [ -z "$out" ]; then echo "FAIL $1: $3 (probe did not run)"; fail=1; return; fi
  expect "$2" "$1: $3" "$out"
}

echo "== placement"
for ns in proj-demo proj-check netpol-control; do
  node=$(k -n $ns get pod check-client -o "jsonpath='{.spec.nodeName}'")
  case $node in k3s-w1|k3s-w2) echo "PASS $ns: client on a worker ($node)";; *) echo "FAIL $ns: client on $node"; fail=1;; esac
done
# No nodeSelector: the leader taint alone must keep it off the leader. Only scheduling is checked.
testpod no-selector | k create -f - >/dev/null 2>&1
testpod pin-leader 'nodeSelector: {kubernetes.io/hostname: k3s-leader}' | k create -f - >/dev/null 2>&1
sleep 10
phase=$(k -n proj-demo get pod pin-leader -o "jsonpath='{.status.phase}'")
if [ "$phase" = Pending ]; then echo "PASS Pod pinned to the leader stays Pending"; else echo "FAIL Pod pinned to the leader is $phase"; fail=1; fi
node=$(k -n proj-demo get pod no-selector -o "jsonpath='{.spec.nodeName}'")
case $node in k3s-w1|k3s-w2) echo "PASS Pod without nodeSelector on a worker ($node)";; *) echo "FAIL Pod without nodeSelector on '$node'"; fail=1;; esac

echo "== proj-demo (student space)"
if k -n proj-demo exec check-client -- nslookup -timeout=3 github.com >/dev/null 2>&1; then echo "PASS proj-demo: cluster DNS (ok)"; else echo "FAIL proj-demo: cluster DNS"; fail=1; fi
run proj-demo ok      "same space Service"           http://web.proj-demo
run proj-demo ok      "internet HTTPS"               https://github.com
run proj-demo ok      "outside DB port 3306"         telnet://portquiz.net:3306
run proj-demo ok      "outside DB port 5432"         telnet://aws-0-ap-northeast-2.pooler.supabase.com:5432
run proj-demo blocked "leader API (Service)"         https://10.43.0.1
run proj-demo blocked "leader API (node address)"    https://192.168.77.11:6443
run proj-demo blocked "image cache"                  http://192.168.77.11:5000/v2/
run proj-demo blocked "kubelet on w1"                https://192.168.77.12:10250
run proj-demo blocked "kubelet on w2"                https://192.168.77.13:10250
run proj-demo blocked "school LAN DNS server"        telnet://10.115.159.15:53
run proj-demo blocked "leader over the tailnet"      "telnet://$TS:22"
run proj-demo blocked "local model (vllm)"           http://vllm.vllm:8000/health
run proj-demo blocked "Traefik Service directly"     http://traefik.kube-system
run proj-demo blocked "other space Service"          http://web.proj-check
run proj-demo blocked "other space Pod"              "http://$CHECKIP:9898"
echo "== proj-check -> proj-demo"
run proj-check blocked "other space Service"         http://web.proj-demo
echo "== netpol-control (same probes without the NetworkPolicy, should reach)"
run netpol-control ok "leader API (Service)"         https://10.43.0.1
run netpol-control ok "image cache"                  http://192.168.77.11:5000/v2/
run netpol-control ok "kubelet on w1"                https://192.168.77.12:10250
run netpol-control ok "school LAN DNS server"        telnet://10.115.159.15:53
run netpol-control ok "leader over the tailnet"      "telnet://$TS:22"

echo "== Traefik -> student Service (Ingress with a test host)"
k apply -f - >/dev/null <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: {name: web-check, namespace: proj-check}
spec:
  ingressClassName: traefik
  rules:
  - host: check.check.invalid
    http: {paths: [{path: /, pathType: Prefix, backend: {service: {name: web, port: {number: 80}}}}]}
EOF
# Traefik picks up a new Ingress within seconds; retry for up to 30 s.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  code=$(ssh k3s-leader 'curl -s -o /dev/null -m 6 -w "%{http_code}" -H "Host: check.check.invalid" http://$(sudo -n k3s kubectl -n kube-system get svc traefik -o jsonpath="{.spec.clusterIP}")/')
  [ "$code" = 200 ] && break; sleep 3
done
if [ "$code" = 200 ]; then echo "PASS Traefik -> proj-check web (200)"; else echo "FAIL Traefik -> proj-check web ($code)"; fail=1; fi

echo "== admission (server dry run)"
# The test Pods pass the build-09 student Pod rule, so a refusal here comes from Pod Security or the cap.
deny() { # deny <label> <expected text> <kubectl args...>   stdin = manifest, if any
  local label=$1 want=$2 out; shift 2
  out=$(k "$@" --dry-run=server 2>&1)
  if echo "$out" | grep -q ValidatingAdmissionPolicy; then echo "FAIL $label refused by the admission policy, not by what is under test"; fail=1
  elif echo "$out" | grep -q "$want"; then echo "PASS $label rejected"
  else echo "FAIL $label: $(echo "$out" | head -1)"; fail=1; fi
}
deny "hostNetwork Pod" PodSecurity create -f - < <(testpod x 'hostNetwork: true')
deny "privileged Pod" PodSecurity create -f - < <(testpod x '' 'privileged: true')
deny "Pod asking 5 CPU" "exceeded quota" create -f - < <(testpod x '' '' 'resources: {requests: {cpu: "5"}, limits: {cpu: "5"}}')
deny "NodePort Service" "exceeded quota" -n proj-demo create service nodeport x --tcp=80:9898 </dev/null

echo "== cleanup"
[ $fail = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
