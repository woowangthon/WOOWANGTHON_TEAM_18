# 클러스터 — 설계

- **상태**: 일부 구현됨 (노드 · 네트워크 · 방화벽 2026-11-06, k3s 설치 2026-11-07, 재부팅 시험 2026-11-08, 리더 GPU · 로컬 모델 2026-11-09, 이미지 캐시 · 학생 공간 양식 · 서버 계정 1차 · 공개 진입 2026-11-10). 배포 실행기 권한 · 지표는 초안
- **관련**: SRS NFR-OPS-01 · NFR-SEC-01 · [ADR-003](../adr/003-registry-ghcr.md) 레지스트리 · [ADR-004](../adr/004-server-cluster-link-tailscale.md) 서버 연결 · [ADR-005](../adr/005-k3s-cluster-on-school-pcs.md) 클러스터 구성 · [ADR-006](../adr/006-metrics-on-leader-prometheus.md) 지표 · [ADR-008](../adr/008-node-network-on-school-wired-lan.md) 노드망 · [ADR-009](../adr/009-deploy-runs-on-leader-gocd-agent.md) 배포 실행기 · [ADR-013](../adr/013-visitor-entry-cloudflare-tunnel.md) 공개 진입 · [시스템 정의서 §5](../system-definition.md#5-인프라) · 구축 task [`20261106-k3s-cluster-build`](../../tasks/active/20261106-k3s-cluster-build-todo.md)

## 범위

- **한다**: 학교 PC 3대(리더 1 + 워커 2)의 노드 설정, 노드 망 · 방화벽, k3s 설치 옵션, 학생 공간 양식(네임스페이스 · 자원 상한 · 네트워크 정책 · 보안 등급), 플랫폼 서버와 리더의 배포 실행기에 주는 권한, 이미지 캐시, 공개 진입, 지표 수집, 리더 GPU · 로컬 모델, 비밀값을 두는 곳, 반납.
- **하지 않는다**: 이미지 빌드(클러스터 밖, ADR-001), 배포 파이프라인 정의(리더의 배포 실행기가 배포 설정으로 매니페스트를 만든다. 실행기 설치 · 연결은 구축 09′, ADR-009), 플랫폼 서버 · AI 서버 실행(AWS).
- **후순위**: 터널 클라이언트를 워커 둘로 옮기기, 리더 상태 스냅샷의 클러스터 밖 백업, 설치 자동화 코드. 데모 경로가 다 선 뒤에 한다.
- **빠짐 (2026-11-07)**: 학생 DB와 학생 볼륨. MVP에서는 학생이 자기 DB를 가져오므로(배포 구조 v15) 플랫폼 MySQL과 볼륨 복제(Longhorn)를 두지 않는다.

구조(무엇이 어디에 있고 왜인지)의 정본은 [시스템 정의서 §5](../system-definition.md#5-인프라)이다. 이 문서는 그 구조를 실제로 만드는 값과 규칙을 적는다.

## 설계

### 1. 노드 (구현됨)

| 노드 | 호스트 이름 | 노드 주소 | 역할 |
| --- | --- | --- | --- |
| PC1 | `k3s-leader` | `192.168.77.11` | k3s server. taint로 학생 Pod를 받지 않는다 |
| PC2 | `k3s-w1` | `192.168.77.12` | k3s agent. 학생 Pod |
| PC3 | `k3s-w2` | `192.168.77.13` | k3s agent. 학생 Pod |

- OS는 Ubuntu 24.04.5 LTS minimized 서버판이다. 원래 OS · 계정 위에 설치하고, 손대기 전에 세 대의 내장 디스크를 통째로 이미지로 떠 두었다(반납 때 되돌린다).
- 호스트 이름은 `hostnamectl`로 바꾸고 `/etc/hosts`의 `127.0.1.1` 줄도 같이 바꿨다. cloud-init이 재부팅 때 이름을 되돌리지 않게 `/etc/cloud/cloud.cfg.d/99-wanggane-preserve-hostname.cfg`(`preserve_hostname: true`)를 둔다.
- 시간대는 Asia/Seoul, 시간 동기화는 켜져 있다. 절전은 막았고, BIOS는 정전 뒤 자동으로 켜진다.
- 원격 관리는 Tailscale 위 SSH로만 한다. SSH는 키 접속만 받는다(`/etc/ssh/sshd_config.d/10-wanggane-keys-only.conf`. 번호가 앞서야 `50-cloud-init.conf`보다 먼저 읽힌다).

### 2. 노드 망 (구현됨)

동아리방 벽 랜 포트 → 설정 없는 기가비트 스위치 → 세 대. 인터넷과 노드끼리 연결이 같은 선을 탄다.

- 각 노드의 유선 랜 카드(`enp4s0`)에 주소가 둘 있다. 학교가 준 고정 주소(인터넷, 기본 경로)와 노드 주소(`192.168.77.0/24`, 게이트웨이 없음)다. 학교 주소가 바뀌어도 k3s는 노드 주소만 쓴다.
- 노드 주소는 원래 netplan 파일을 고치지 않고 `/etc/netplan/60-wanggane-node.yaml` 하나에 둔다. netplan이 두 파일의 주소 목록을 합친다. 적용 전에 `netplan generate` 결과에 주소 둘과 학교 게이트웨이 하나가 있는지 본다.
- 잰 값(2026-11-06): 노드 사이 iperf3 약 941Mbit/s, 재전송 0.
- 노드 이름은 `/etc/hosts`의 `# wanggane-nodes` 블록에 노드 주소로 적는다.

### 3. 방화벽 (구현됨)

ufw로 들어오는 연결과 나가는 연결을 모두 기본 거부하고 아래만 연다. 유선에는 클라이언트 격리가 없어 같은 선의 학교망 기기가 노드에 바로 닿으므로, 노드 대역은 인터페이스가 아니라 **출발지 주소**로 허용한다.

| 방향 | 허용 | 용도 |
| --- | --- | --- |
| 들어옴 | `tailscale0` 인터페이스 | 원격 SSH, 플랫폼 서버 → 리더 API |
| 들어옴 | 출발지 `192.168.77.0/24` | 노드끼리 (k3s API 6443, kubelet 10250, 지표 9100, 이미지 캐시 5000 등. flannel은 host-gw라 VXLAN 8472를 쓰지 않는다, §4) |
| 들어옴 | 출발지 `10.42.0.0/16` · `10.43.0.0/16` | k3s Pod · 서비스 대역 |
| 나감 | `tailscale0`, `192.168.77.0/24`, `10.42.0.0/16`, `10.43.0.0/16` | 위와 같은 길 |
| 나감 | 53, 123/udp | DNS, 시간 동기화 |
| 나감 | 80/tcp, 443/tcp | 패키지, 레지스트리, Tailscale 제어 · 중계, Discord 알림 |
| 나감 | 41641/udp, 3478/udp | Tailscale 직접 연결 시도 (막혀도 443 중계로 붙는다) |
| 나감 (리더만) | 7844 (tcp · udp) | Cloudflare Tunnel을 호스트에서 돌릴 때의 길. 지금 cloudflared는 Pod라 이 줄을 쓰지 않는다(아래 Pod 줄, §9) |
| 거쳐 감 (FORWARD) | 출발지 또는 목적지 `10.42.0.0/16` | Pod 통신. NetworkPolicy(k3s의 kube-router)가 이보다 앞에서 걸린다 |

- 나가는 쪽을 도메인이 아니라 포트로 거르는 것은 ufw가 도메인을 모르고, 레지스트리 · 패키지 저장소 · Tailscale이 CDN 뒤라 IP가 바뀌기 때문이다.
- 이 표는 **호스트 프로세스**(containerd, k3s, Tailscale, apt 등)에만 걸린다. Pod에서 나가는 통신은 NAT 뒤 FORWARD 체인을 타서 이 표가 적용되지 않는다. 그래서 학생 Pod는 NetworkPolicy(§6)로 막고, 운영 도구 Pod(cloudflared · CoreDNS의 바깥 DNS 질의)는 띄울 때(10) 필요한 목적지 · 포트만 여는 NetworkPolicy로 따로 묶는다(05에서 본 FORWARD 동작은 아래). 이미지 캐시는 hostNetwork로 띄워서 호스트 프로세스처럼 이 표가 그대로 걸린다(§5). 그 전까지 "리더만 7844"는 호스트 기준이다.
- 확인한 것(2026-11-06): 사설망으로 세 대 SSH 됨, 노드 주소로는 22번이 열리고 학교 주소로는 막힘, DNS · HTTPS · GHCR · `apt update` · 시간 동기화 · Tailscale 됨, 8080 같은 다른 포트와 워커의 7844는 막힘, 부팅 때 ufw가 켜짐.
- k3s 설치(§4, 2026-11-07)에서 본 것: FORWARD 체인은 kube-router(NetworkPolicy) → kube-proxy → Docker · Tailscale → ufw → flannel 순서다. 평소 Pod 통신은 맨 앞 kube-router 체인이 받지만, 새 Pod의 첫 패킷은 그 Pod의 규칙이 생기기 전에 ufw의 routed 기본 거부에 걸렸다. 그래서 위 표의 FORWARD 줄(`ufw route allow`, 양방향)을 더했다. NetworkPolicy는 그보다 앞이라 그대로 걸린다(거부 정책을 넣고 빼서 시험했다). flannel의 허용 규칙도 Pod 대역 전체를 받으므로, Pod 바깥 통신을 거르는 건 NetworkPolicy 몫이다. 이미 깔린 Docker는 `docker0`에만 규칙을 걸어 Pod 통신에 영향이 없고 컨테이너도 없다.
- hostPort와 NodePort는 DNAT 뒤 FORWARD로 가서 ufw의 들어오는 거부(INPUT)를 비켜 간다. 그래서 §4에서 ServiceLB(Traefik의 hostPort 80/443)를 끄고 NodePort를 노드 대역으로 묶었다. 확인(2026-11-07): 다른 노드의 학교 주소와 그 노드의 Pod(학교 주소로 바뀌어 나간다)에서 재 보니 학교 주소로는 6443 · 80 · 443 · 10250 · NodePort가 닫혀 있고, 받는 쪽 ufw 차단 기록의 출발지가 학교 주소였다.
- ufw 규칙 주석에 `in` · `out` 같은 낱말을 넣으면 ufw가 방향 키워드로 읽어 `route` 규칙이 거절된다.

**원격으로 접속을 끊을 수 있는 변경**(네트워크 · sshd · 방화벽)은 한 대씩(w2 → w1 → 리더) 하고, 먼저 되돌리기를 예약한다: `systemd-run --on-active=150 <되돌리는 명령>` → 적용 → 바깥에서 다시 접속 → `systemctl stop <유닛>.timer`. 다시 붙지 못하면 150초 뒤 저절로 원래대로 돌아온다.

### 4. k3s 설치 (구현됨, 2026-11-07)

- 버전: k3s `v1.37.2+k3s1`(containerd 2.3.7-k3s1). 같이 깔리는 Traefik은 차트 41.6.1(이미지 3.7.15), 우리 CoreDNS는 1.14.7(k3s 기본과 같은 이미지). 설치 스크립트에는 `INSTALL_K3S_VERSION`만 주고 옵션은 설정 파일 `/etc/rancher/k3s/config.yaml`에 둔다. 레포 사본은 [`Infra/k3s/server.yaml`](../../Infra/k3s/server.yaml) · [`Infra/k3s/agent.yaml`](../../Infra/k3s/agent.yaml)이다(리더의 Tailscale 주소 · 노드 주소는 자리표시자).
- 리더(server): `cluster-init`(내장 etcd. 서버는 하나지만 후순위인 스냅샷 복구를 할 여지를 남긴다), `node-ip` · `advertise-address` = 노드 주소, `tls-san` = 노드 주소 · 리더의 Tailscale 주소(플랫폼 서버가 이 주소로 API를 부른다) · `k3s-leader`, `disable: [coredns, servicelb]`(아래), `secrets-encryption`(etcd의 Secret을 암호화한다. `k3s secrets-encrypt status`가 Enabled), `node-taint: node-role.kubernetes.io/control-plane:NoSchedule`(설치 옵션이라 처음부터 걸린다).
- 워커(agent): 리더의 노드 주소(`https://192.168.77.11:6443`)로 조인한다. `node-ip` = 자기 노드 주소, 토큰은 `token-file`(`/etc/rancher/k3s/token`, 권한 600)로 읽는다. 라벨 `wanggane/pool=student`(`node-role.kubernetes.io/` 접두어는 노드가 자기에게 붙일 수 없다).
- flannel: 세 노드 `flannel-iface: enp4s0`, 백엔드 `host-gw`, 다음 홉은 노드 주소(각 노드 `node-external-ip` = 노드 주소, 서버 `flannel-external-ip: true`). `--flannel-iface`는 랜 카드만 고르고 VXLAN 출발지는 그 카드의 첫 주소(학교 주소)라서, VXLAN이면 받는 쪽 방화벽이 그 출발지를 막아 노드 사이 Pod 통신이 끊긴다. v1.37.2에는 그 주소를 고르는 옵션이 없어 캡슐화가 없는 host-gw로 바꿨다(세 대가 한 스위치에 있어 된다). Pod 경로는 `10.42.N.0/24 via 192.168.77.x`다. 노드를 더할 때는 `flannel.alpha.coreos.com/public-ip`가 노드 주소인지 본다.
- ServiceLB는 끈다. 켜 두면 Traefik의 hostPort 80/443이 모든 주소에서 열리는데, hostPort는 DNAT 뒤 FORWARD로 가서 ufw의 들어오는 거부(§3)를 비켜 간다. 방문자는 터널로 클러스터 안 Traefik에 닿으므로 호스트 80/443이 필요 없다. NodePort도 같은 길이라 kube-proxy를 `nodeport-addresses=192.168.77.0/24`로 두어 노드 대역에서만 받는다(서버 · 워커 둘 다).
- 노드가 꺼졌을 때 기다리는 시간은 Pod마다 넣지 않고 API 서버에서 한 번에 줄인다: `default-not-ready-toleration-seconds=30`, `default-unreachable-toleration-seconds=30`(kube-apiserver, 기본 300초). 노드가 NotReady로 잡히기까지는 약 50초다(kube-controller-manager 기본값. 2026-11-08 워커의 k3s-agent를 멈춰서 쟀다). 그래서 노드가 꺼진 뒤 남은 워커에 다시 띄우기 시작하기까지 약 80초다.
- 재부팅 시험(2026-11-08): w1 → w2 → 리더를 한 대씩 원격으로 재부팅했다. 셋 다 35~45초 만에 사람 손 없이 돌아왔고, k3s · ufw(FORWARD 줄 포함) · 노드 주소 · Pod 경로가 그대로 켜졌다. 재부팅이 NotReady 판정(약 50초)보다 짧아 Pod가 다른 노드로 옮겨지지 않고 같은 노드에서 다시 떴다. 전원을 통째로 뽑는 시험은 아직이다.
- 배치 규칙: 워커에 학생용 라벨, 리더에 `NoSchedule` taint. 학생 Pod는 라벨로 워커에 가고, 서버 양식이 nodeSelector를 빠뜨려도 taint가 막는다. 리더에는 toleration을 단 운영 도구만 뜬다.
- CoreDNS는 k3s 기본을 끄고 직접 띄운다: 워커 둘에 하나씩(복제본 2), 클러스터 DNS 주소는 k3s 기본값 `10.43.0.10`. k3s 기본은 복제본 1이라 리더에 뜰 수 있고, k3s가 시작할 때마다 기본 설정으로 되돌린다. 매니페스트는 [`Infra/coredns/coredns.yaml`](../../Infra/coredns/coredns.yaml)이다(k3s v1.37.2의 것에서 복제본 2, 워커 라벨, 노드당 하나만 바꿨다). k3s는 자기 CoreDNS를 끄면 `NodeHosts`를 채우지 않아서 세 노드 이름을 그 파일에 적었다.
- Traefik(k3s 기본 Ingress)은 `HelmChartConfig`([`Infra/k3s/traefik-config.yaml`](../../Infra/k3s/traefik-config.yaml), 2026-11-10)로 워커 둘에 하나씩 둔다(복제본 2, 학생용 라벨, 같은 노드에 둘을 못 두는 규칙). k3s 기본은 복제본 1이라 그 워커가 죽으면 터널이 살아 있어도 보낼 곳이 없었다. 워커가 둘뿐이라 업데이트 때 하나를 더 띄울 자리가 없으므로 하나씩 내렸다 올린다(`maxUnavailable 1` · `maxSurge 0`. 차트 기본 `maxSurge 1`이면 끝나지 않는다). 공개 진입 설정은 §9.
- k3s 토큰(서버 토큰)은 리더에 있고, 조인에 쓴 사본이 워커 둘의 `/etc/rancher/k3s/token`(권한 600)에도 있다. 레포 · 노션 · 채팅에는 올리지 않고, 운영자가 비밀번호 관리자에 사본을 둔다. 서버 토큰은 워커뿐 아니라 리더로도 붙을 수 있는 열쇠라서, 학생 앱을 받기 전(08)에 워커에는 워커 전용 `agent-token`을 줄지 정한다.

### 5. 이미지 (구현됨, 2026-11-10)

- 리더에 GHCR 끌어오기 캐시(pull-through)를 둔다: `registry:3.1.2`(CNCF Distribution)의 proxy 모드, 원본 `https://ghcr.io`, 받아 둔 것은 7일(`ttl: 168h`) 뒤 지운다. 저장은 리더 로컬 디스크(local-path, 리더의 `/var/lib/rancher/k3s/storage/<PV 이름>_registry-cache_registry-cache`). 50Gi는 요청값일 뿐 상한이 아니다: local-path는 크기를 막지 않고 캐시에도 크기 제한 설정이 없어, 7일 TTL이 유일한 정리다. 리더 디스크 알림(§10, 구축 11)이 이 경로를 같이 본다. 설정은 `Infra/registry-cache/registry-cache.yaml`.
- 캐시는 `hostNetwork`로 띄우고 노드 주소 `192.168.77.11:5000`에만 묶는다. 그래서 §3 표가 호스트 프로세스와 똑같이 걸린다: 들어오는 건 노드 대역에서만, 나가는 건 §3 표의 나가는 줄(캐시가 실제로 쓰는 건 GHCR 443과 DNS 53). hostPort는 DNAT 뒤 FORWARD로 가서 들어오는 거부를 비켜 가므로 쓰지 않는다. baseline 보안 등급이 hostNetwork를 막아 `registry-cache` 공간만 privileged로 두고(warn은 baseline), 컨테이너는 non-root(UID 1000) · capability 없음 · 읽기 전용 루트 파일시스템으로 돈다. 이름 풀이는 클러스터 DNS(워커에 있다)가 아니라 호스트 것을 쓴다(`dnsPolicy: Default`).
- 세 노드의 `/etc/rancher/k3s/registries.yaml`(권한 600, `Infra/k3s/registries.yaml`)이 `ghcr.io`의 mirror로 리더 캐시를 둔다. containerd는 레지스트리 자신의 주소를 마지막 시도로 늘 남겨 두므로(k3s 기본), 캐시가 죽으면 GHCR에서 직접 받는다. 이미지가 공개라 노드에도 캐시에도 자격증명이 없다(ADR-003). 파일을 바꾸면 k3s를 다시 시작해야 한다(w2 → w1 → 리더 순서로 한 대씩, 돌던 컨테이너는 그대로).
- 시험(2026-11-10, `ghcr.io/stefanprodan/podinfo:6.15.0`, 34.8MB): w1이 처음 받을 때 캐시가 GHCR에서 가져오며 넘겨줘 1분 53초, 이어서 w2는 1.1초였고 그동안 캐시가 GHCR에 간 기록은 없었다. 캐시를 0개로 내리고 w1의 이미지를 지운 뒤 다시 받으니 containerd가 연결 거부를 받고 바로 GHCR로 넘어가 44초에 받았다. 리더가 꺼진 경우는 w1에서 리더 5000번으로 가는 패킷을 버려(DROP) 흉내 냈다: containerd가 연결 시간 초과 30초를 한 번 기다린 뒤 GHCR로 넘어가 모두 3분 37초에 받았다(그중 GHCR에서 받은 시간 3분 6초. 같은 이미지가 앞서 44초였으니 학교망의 GHCR 속도가 들쭉날쭉하다). 리더 전원을 실제로 끈 시험은 아니다. 학교 주소에서 리더 5000번은 닫혀 있다(시간 초과).

### 6. 학생 공간 양식 (구현됨, 2026-11-10)

프로젝트마다 만드는 공간의 틀. 공간 · 보안 등급 · 자원 상한 · 차단 규칙은 플랫폼 서버가 처음에 만들고, 앱 자원(Deployment · Service · Ingress)은 리더의 배포 실행기가 배포 설정에서 값을 뽑아 채운다. 양식은 [`Infra/student/space.yaml`](../../Infra/student/space.yaml)이고 시험 공간 `proj-demo`에 적용해 두었다. 서버는 이 파일에서 이름만 `proj-<id>`로 바꿔 Namespace · LimitRange · ResourceQuota · NetworkPolicy와 RoleBinding 둘, 모두 여섯을 만든다(RoleBinding 하나는 서버가 그 공간을 읽게 하고, 하나는 배포 실행기가 그 공간에 배포하게 하는 권한 연결이다, §8). 배포 실행기의 `student-app` 차트가 서비스마다 넣어야 할 필드와, `stripPrefix`를 쓰는 서비스에 더 만드는 Middleware는 [`Infra/student/app-example.yaml`](../../Infra/student/app-example.yaml)에 있다.

| 항목 | 값 |
| --- | --- |
| 이름 | `proj-<id>` |
| 보안 등급 | Pod Security `enforce=baseline`, `warn=restricted`. restricted로 강제하면 root로 도는 공식 이미지(nginx · node 등)가 거절된다 |
| 컨테이너 권한 | 모든 컨테이너에서 `NET_RAW` capability를 뺀다(`securityContext.capabilities.drop: ["NET_RAW"]`). baseline은 이걸 빼지 않아, 같은 워커의 학생 Pod가 ARP 스푸핑으로 다른 Pod 통신을 가로챌 수 있다. 배포 실행기가 매니페스트에 넣는다. 빠진 Pod와 Deployment는 검사 규칙(§8)이 거절한다(2026-11-10) |
| API 토큰 | 학생 Pod에는 쿠버네티스 API 토큰을 넣지 않는다(`automountServiceAccountToken: false`). 학생 앱은 API를 쓸 일이 없다. 서버는 공간 안 객체를 만들기만 할 수 있어(§8) 공간의 `default` ServiceAccount는 쿠버네티스가 만든 그대로 두고, 배포 실행기가 Pod마다 끈다. 토큰이 켜진 Pod와 Deployment는 검사 규칙(§8)이 거절한다(2026-11-10) |
| 배치 | 워커에만(nodeSelector `wanggane/pool: student` + 리더 taint). toleration을 달거나 `nodeName`으로 노드를 직접 지정한 Pod와 Deployment는 검사 규칙(§8)이 거절한다(2026-11-11). 앱 복제본 1 |
| 프로젝트 자원 상한 (ResourceQuota) | CPU 요청 4 · 상한 8, 메모리 요청 16Gi · 상한 32Gi, 임시 저장소(로그 · emptyDir · 컨테이너 쓰기 층) 요청 10Gi · 상한 40Gi, Pod 10개, 볼륨(PVC) 0 · 볼륨 요청 0(학생 볼륨 없음), NodePort · LoadBalancer Service 0(방문자는 Traefik으로만 들어온다. NodePort는 노드 대역에 앱을 바로 연다). 워커 하나(24스레드 · 125GiB)의 절반 아래로, 워커가 하나 꺼져 두 프로젝트가 한 워커에 떠도 시스템 몫이 남는다. 값은 구축 담당이 정했다(2026-11-10. 서버는 양식을 그대로 만들 뿐 값을 쓰지 않는다) |
| 컨테이너 기본값 (LimitRange) | 요청 CPU 250m · 메모리 256Mi · 임시 저장소 1Gi, 상한 CPU 2 · 메모리 4Gi · 임시 저장소 8Gi(없으면 한 Pod가 워커 디스크를 채워 같은 워커의 Pod가 모두 쫓겨난다). 스펙에 값이 없을 때만 채운다. 컨테이너 하나의 최대치가 아니며, 합계는 위 상한이 막는다 |
| 들어오는 통신 (NetworkPolicy) | 같은 공간, Ingress(Traefik)에서만 |
| 나가는 통신 (NetworkPolicy) | 같은 공간, 클러스터 DNS, 인터넷(학생 DB가 밖에 있다). 학교망 `10.198.0.0/16`, 클러스터 내부(`10.42.0.0/16` · `10.43.0.0/16`, DNS 빼고), 노드 대역 `192.168.77.0/24`, Tailscale `100.64.0.0/10`, 그 밖의 사설 대역, 다른 학생 공간은 막는다 |
| 노드가 꺼졌을 때 | 약 50초 뒤 NotReady가 되고(2026-11-08 잼), 포기 대기 30초(기본 5분)가 지나 약 80초에 남은 워커에 다시 띄운다. 포기 대기 값은 API 서버에서 한 번에 준다(§4). 서버 양식에 따로 넣지 않는다 |
| DB | 학생 것(MVP). 학생이 넣은 접속 정보를 Secret으로 환경 변수에 주입한다. 클러스터에 DB와 볼륨을 두지 않는다 |

- 상한에서 먼저 닿는 것은 CPU 상한 합계다. 기본값만 쓰는 컨테이너는 상한 8 ÷ 2 = 4개까지 뜬다(CPU 요청으로는 16개, 메모리로는 8개, 임시 저장소로는 5개, Pod 10개). FE · BE · AI 셋이면 상한 합계 6이고, Deployment는 새 Pod를 먼저 띄우고 옛 Pod를 지우므로(복제본 1이면 하나 더) 배포 하나가 도는 동안 8로 꽉 찬다. 두 서비스를 동시에 배포하면 두 번째 새 Pod는 첫 배포가 끝날 때까지 만들어지지 않는다(실패가 아니라 기다린다). 그래서 배포 실행기는 한 프로젝트의 서비스를 하나씩 차례로 배포한다. 차트가 서비스마다 상한을 적으면 기본값은 쓰이지 않는다.
- 공간을 만든 직후 잠깐은 `default` ServiceAccount가 아직 없어 Pod를 만들 수 없다. 서버는 기다리지 않는다(ServiceAccount를 읽을 권한도 없다, §8). Pod는 배포 실행기의 Deployment에서 나오고, Deployment 컨트롤러가 ServiceAccount가 생길 때까지 다시 시도한다.
- 시험(2026-11-10, [`Infra/student/check.sh`](../../Infra/student/check.sh), 운영자 기기에서 실행): 같은 양식으로 공간을 하나 더(`proj--check`. 하이픈이 둘이라 어떤 `slug`도 이 이름이 되지 않는다), 정책 없는 대조 공간을 하나 만들고 각 공간의 시험 Pod에서 재 본 뒤 지운다.
  - 된다: 같은 공간 Service, 클러스터 DNS, 인터넷 HTTPS, 바깥 DB 포트 3306 · 5432(학교망에서도 열려 있다), Traefik → 학생 Service(Ingress 시험 호스트로 200. 다른 워커 쪽은 스크립트를 만들기 전에 손으로 쟀다).
  - 막힌다: 리더 API(Service 주소 · 노드 주소), 이미지 캐시, 두 워커의 kubelet, 학교망 DNS 서버, 리더의 Tailscale 주소, 로컬 모델(`vllm`), Traefik Service에 직접, 다른 학생 공간(Service · Pod 주소, 양쪽 방향). 대조 공간에서는 같은 대상에 닿아, 막는 것이 이 정책임을 확인했다. 막힌 연결은 시간 초과가 아니라 바로 거절된다.
  - 받아들여지지 않는다(서버 쪽 dry run): hostNetwork · privileged Pod, CPU 5개를 요청하는 Pod(상한 초과), NodePort Service. NodePort Service는 2026-11-11부터 상한보다 앞에서 Service 검사 규칙(§8)이 거절한다(상한의 `services.nodeports: 0`은 둘째 겹으로 남는다). 배치: 워커 라벨을 단 시험 Pod는 워커에, nodeSelector가 없는 Pod도 리더 taint 때문에 워커에 뜨고, 리더를 지정한 Pod는 Pending으로 남는다. 스크립트가 중간에 멈춰도 만든 것은 지우고, 시험 Pod에 들어가지 못한 측정과 연결 거절 · 시간 초과가 아닌 curl 오류(이름 풀이 실패 등)는 "막힘"이 아니라 실패로 센다.
  - 리더 호스트에서 학생 Pod로 바로 가는 길도 막힌다. 배포 뒤 동작 확인(배포 실행기)은 Traefik을 거쳐야 한다.

### 7. 학생 볼륨 (빠짐)

- 학생 DB가 학생 것으로 바뀌어(2026-11-07, 배포 구조 v15) 학생 볼륨을 두지 않는다. Longhorn, 노드 다운 시 Pod 삭제 정책, 볼륨 크기 상한, 볼륨 방식 ADR이 모두 빠졌다.
- 저장 클래스는 k3s 기본 `local-path` 하나다. 리더에 두는 것(이미지 캐시, Prometheus, Grafana)은 리더 로컬 디스크를 쓴다.
- 워커가 꺼지면 학생 앱만 남은 워커에 다시 뜬다(§6 "노드가 꺼졌을 때"). 데이터는 학생 DB에 있어 따라갈 것이 없다.

### 8. 플랫폼 서버와 배포 실행기의 권한 (서버 계정 1차 2026-11-10 · 실행기 계정 2026-11-11 구현됨, 나머지 예정)

배포는 리더의 배포 실행기(GoCD Agent)가 하고, 플랫폼 서버는 비밀값 · 조치 · 조회만 한다([ADR-009](../adr/009-deploy-runs-on-leader-gocd-agent.md)). 계정을 둘로 나누고 두 겹으로 막는다.

**만든 것 (구축 09, [`Infra/platform/`](../../Infra/platform/))**: 플랫폼 서버가 공간을 만들고, 비밀값을 넣고, 자기가 만든 공간을 읽는 데 쓰는 것까지다.

- 계정: 운영 공간 `platform`의 ServiceAccount `platform-server`. 토큰은 만료 없는 것 하나(Secret `platform-server-token`)이고, 그 Secret을 지우면 폐기된다.
- 권한: 네임스페이스 만들기 · 삭제, ResourceQuota · LimitRange · NetworkPolicy 만들기, Secret 만들기 · 통째로 바꾸기(`create` · `update`), 권한 연결(RoleBinding) 만들기(자기 읽기용과 실행기 배포용 둘), 노드 읽기. Secret 읽기와 `patch`는 없다. patch의 응답은 Secret 전체라, 빈 patch 하나로 값을 읽을 수 있기 때문이다. 통째로 바꾸기(PUT)의 응답은 보낸 값뿐이다.
- 읽기: 서버는 `proj-` 공간 안의 Pod · 로그 · Deployment만 읽는다. 검사 규칙은 쓰기만 걸러서 읽기는 이름으로 좁힐 수 없다. 그래서 읽기 권한을 클러스터 전체에 주지 않고, 읽기 역할 `proj-reader`를 따로 두고 서버가 공간을 만들 때 그 공간에 권한 연결 `platform-server-read`를 같이 만든다(양식의 다섯째 객체). 서버가 연결할 수 있는 역할은 `proj-reader` 하나뿐이다(RBAC `bind`). 연결이 없는 공간과 `kube-system` · `vllm` 등은 읽지 못한다. 노드는 공간에 속하지 않아 클러스터 범위로 읽는다(이름 · 주소 · Ready 상태).
- 검사 규칙 일곱
  - `wanggane-platform-server`: 서버 계정의 쓰기 · 삭제는 `proj-`로 시작하는 공간에서만 통과한다. 네임스페이스는 만들기 · 삭제만 되고, 만들 때 라벨이 보안 등급 둘(`enforce=baseline`, `warn=restricted`)뿐이어야 한다. Secret은 타입이 `Opaque`이고 이름이 `<서비스>-secrets`일 때만 통과한다(서비스 계정 토큰 타입 Secret으로 공간 안에서 토큰을 찍어내지 못하게).
  - `wanggane-space-quota` · `-limits` · `-isolation`: 서버 계정이 만드는 ResourceQuota · LimitRange · NetworkPolicy는 이름과 값이 §6 양식과 같을 때만 통과한다. 양식 값을 규칙에 베끼지 않고, 양식을 그대로 적용해 둔 기준 공간 `student-template`의 객체와 비교한다. 기준 객체가 없으면 그 종류를 만드는 요청이 계정 · 공간을 가리지 않고 모두 거절된다(기준을 계정보다 먼저 찾는다). 기준 공간만은 규칙에서 빼 두어 기준을 언제든 다시 넣을 수 있다. 이름까지 묶는 것은 NetworkPolicy가 여러 개면 허용이 합쳐져, 다른 이름으로 하나 더 만들면 차단이 풀리기 때문이다.
  - `wanggane-space-readers` · `-deployers`: 서버 계정이 만드는 권한 연결은 이름 · 역할 · 대상 계정이 양식의 둘(`platform-server-read`, `deploy-executor`) 중 하나와 같을 때만 통과한다. 같은 방식으로 기준 공간의 객체와 비교한다. 이름이 `deploy-executor`인 연결은 `-deployers`가, 그 밖의 이름은 `-readers`가 본다.
  - `wanggane-student-pods`: `proj-` 공간의 Pod와 Deployment는 모든 컨테이너에서 `NET_RAW`를 빼고 API 토큰 자동 마운트를 끈 것만 통과한다. 같은 토큰을 손으로 마운트하는 길(projected 볼륨의 `serviceAccountToken`)도 거절한다. toleration과 `nodeName`도 거절한다(2026-11-11): 리더 taint는 `NoSchedule`이라 toleration을 단 Pod와, 스케줄러를 거치지 않는 `nodeName` 지정 Pod는 막지 못하기 때문이다. 쿠버네티스가 모든 Pod에 스스로 넣는 toleration 둘(`not-ready` · `unreachable`, `NoExecute`)만 통과시킨다. 운영자를 포함한 모든 계정에 걸린다. Deployment도 보는 것은 배포 실행기가 적용할 때 바로 거절을 받게 하려는 것이다(Pod만 보면 거절이 ReplicaSet 이벤트로만 남는다).
- 서버가 받는 응답: 권한이 없으면 `403`, 검사 규칙에 걸리면 `422`(메시지에 규칙 이름과 이유), 이미 있으면 `409`, 토큰이 틀리면 `401`.
- 시험(2026-11-10, [`Infra/platform/check.sh`](../../Infra/platform/check.sh), 운영자 기기에서 실행): 서버 계정으로(impersonation) 양식 그대로 공간 하나를 만들고 Secret을 만들고 바꾼다. 거절되는 것: `proj-` 아닌 이름, 라벨이 없거나 다르거나 더 붙은 공간, `vllm` · `student-template` · `kube-system` 삭제, 값을 바꾼 상한 · 기본값 · 차단 규칙, 다른 이름의 차단 규칙, 상한 · 차단 규칙 지우기 · 고치기, Secret 읽기 · 목록 · patch · 삭제, 다른 이름이나 토큰 타입의 Secret, `proj-` 밖 Secret 쓰기, Pod · Deployment 만들기, 다른 이름이나 다른 계정의 권한 연결(실행기용 연결을 다른 계정 · 다른 역할 · 다른 이름으로 만드는 것 포함), `cluster-admin` 연결, 권한 연결 지우기, Middleware 만들기. 읽기: 자기가 만든 공간과 `proj-demo`의 Pod · 로그 · Deployment, 노드는 읽힌다. `kube-system` · `vllm`의 Pod와 로그, 모든 공간 한꺼번에 읽기, 권한 연결이 없는 공간, Secret · ConfigMap 읽기, Pod 안에서 명령 실행은 거절된다. 실제 객체를 겨누는 거절 시험은 server dry run으로 보낸다. 실제 토큰으로 리더의 Tailscale 주소를 불러 `201` · `409` · `422` · `403` · `401`도 확인했다. EC2에서 닿는지는 EC2가 사설망에 들어온 뒤 본다.

**만든 것 (구축 09′, [`Infra/executor/`](../../Infra/executor/), 2026-11-11)**: 배포 실행기가 학생 공간에 배포하고 결과를 읽는 데 쓰는 계정이다. 실행기 Pod(GoCD Agent)는 아직 없다.

- 계정: 운영 공간 `deploy`의 ServiceAccount `deploy-executor`. 오래 가는 토큰을 만들지 않는다. 실행기 Pod가 이 공간에서 뜨면 쿠버네티스가 기한 있는 토큰을 넣어 주므로 토큰이 리더 밖으로 나가지 않는다.
- 권한: 클러스터 전체 권한은 하나도 없다. 할 수 있는 일은 역할 `proj-deployer`에 모두 있고, 권한 연결 `deploy-executor`가 있는 공간에서만 그 역할을 가진다. 연결은 플랫폼 서버가 공간을 만들 때 같이 만든다(양식의 여섯째 객체).
  - 쓰기: Deployment · Service · ConfigMap · Ingress · Traefik Middleware(`middlewares.traefik.io`) 만들기 · 고치기 · 지우기. `kubectl apply`가 쓰는 `get` · `patch`가 들어 있어 Render의 `--dry-run=server`도 같은 권한으로 된다.
  - 읽기: 위 다섯 종류와 Pod · ReplicaSet · 이벤트 · Endpoints · EndpointSlice(`get` · `list` · `watch`). 롤아웃 대기, 빠른 실패 신호, W6의 Pod Ready · Endpoints 확인, Prepare의 open Ingress 읽기에 쓴다.
  - 없는 것: Secret(읽기 · 쓰기 모두), Pod 로그 · Pod 안 명령 실행, Pod 직접 만들기, 네임스페이스 · ResourceQuota · LimitRange · NetworkPolicy · RoleBinding, Middleware 밖의 Traefik 리소스(IngressRoute 등), 노드.
- 쓰기와 읽기를 한 연결에 묶은 이유: `kubectl apply`는 쓰기 전에 대상을 읽으므로(`get`) 읽기 연결이 없는 공간에서는 쓰기 권한도 쓸 수 없다. 읽기는 검사 규칙으로 좁힐 수 없어 어차피 공간마다 연결이 필요하니, 쓰기까지 그 연결에 담아 클러스터 전체 권한을 없앴다.
- 검사 규칙 셋 ([`Infra/executor/policies.yaml`](../../Infra/executor/policies.yaml))
  - `wanggane-deploy-executor`: 실행기 계정의 쓰기 · 삭제는 `proj-`로 시작하는 공간에서만 통과한다. 권한 연결이 다른 공간에 생겨도(기준 공간 `student-template`에는 비교용 연결이 있다) 쓰지 못하게 하는 둘째 겹이다.
  - `wanggane-student-middlewares`: `proj-` 공간의 Middleware는 `spec`에 `stripPrefix` 하나만 든 것만 통과한다. 리다이렉트 · `forwardAuth` · 플러그인 · 머리글 바꾸기 등은 방문자나 요청을 다른 곳으로 보낼 수 있어 거절한다. 운영자를 포함한 모든 계정에 걸린다. `stripPrefix`는 배포 입력의 `runtime.stripPrefix`에 필요하다(#72, 2026-11-11 결정. 학생 백엔드마다 받는 경로가 다르고 프로젝트마다 호스트가 하나다).
  - `wanggane-student-services`: `proj-` 공간의 Service는 `ClusterIP` 타입이고 `externalIPs`가 없는 것만 통과한다. kube-proxy는 Service의 `externalIPs`로 가는 클러스터 안 통신을 그 Service의 Pod로 보내므로, 학생 Service가 이미지 캐시 주소(`192.168.77.11:5000`)를 적으면 노드의 이미지 요청을 받게 된다(셀프 리뷰에서 찾음, 2026-11-11). `ExternalName`은 아무 이름의 별칭이 된다. 모든 계정에 걸린다.
- 차트가 내야 할 것([`Infra/student/app-example.yaml`](../../Infra/student/app-example.yaml)): `stripPrefix: true`인 서비스는 Middleware 하나와, 그 서비스로 가는 Ingress의 주석 `traefik.ingress.kubernetes.io/router.middlewares: <공간>-<Middleware 이름>@kubernetescrd`. 주석은 그 Ingress의 모든 경로에 걸린다. 공간 이름에 하이픈이 연달아 있으면(`proj-a--b`. `slug` 규칙이 막지 않는다) Traefik이 Middleware 이름에서 하나로 줄이므로(`proj-a-b-<이름>`) 주석도 그렇게 적어야 한다. 그대로 적으면 Traefik이 Middleware를 찾지 못해 그 Ingress 전체가 404가 된다(2026-11-11 확인, Traefik 3.7.15).
- 시험(2026-11-11, [`Infra/executor/check.sh`](../../Infra/executor/check.sh), 운영자 기기에서 실행): 양식으로 시험 공간을 하나 만들고(이름이 `slug` 최대 길이 40자보다 길어 학생 공간과 겹치지 않는다) 실행기 계정으로(impersonation) 예시 앱을 실제로 배포한 뒤 지운다.
  - 된다: 예시 앱의 server dry run과 적용(Deployment · Service · Middleware · Ingress · ConfigMap), 롤아웃 대기, Pod · 이벤트 · Endpoints · EndpointSlice · ReplicaSet · Ingress 읽기, Ingress 고치기, Deployment 0개로 줄이기, 라벨로 지우기. Traefik을 거친 요청은 `/readyz` 200, `stripPrefix`가 걸린 `/svc/readyz` 200(앱은 `/readyz`를 받는다), Ingress에서 Middleware를 떼면 같은 경로가 404.
  - 거절된다(권한): `kube-system` · `vllm`의 Deployment · Middleware 쓰기와 Pod · ConfigMap 읽기, 모든 공간 한꺼번에 읽기, 노드 읽기, Secret 읽기 · 만들기, 자기가 배포한 Pod의 로그 · Pod 안 명령 실행, Pod 직접 만들기, 네임스페이스 만들기 · 삭제, ResourceQuota 고치기, LimitRange · NetworkPolicy 지우기, NetworkPolicy · RoleBinding 만들기, 자기 권한 연결 지우기, IngressRoute 만들기.
  - 거절된다(검사 규칙): 기준 공간에 Deployment · Middleware 쓰기, `redirectScheme` · `forwardAuth` · 플러그인 · `stripPrefixRegex` Middleware, `stripPrefix`에 다른 것을 같이 넣은 Middleware, 빈 Middleware(운영자가 만들어도 거절), `externalIPs`를 적은 Service(운영자가 만들어도 거절) · `ExternalName` Service, 리더 taint나 모든 taint를 견디는 toleration을 단 Deployment · Pod, `nodeName`을 적은 Deployment · Pod, API 토큰을 켠 Deployment.
  - 같은 날 `Infra/platform/check.sh` · `Infra/student/check.sh`도 다시 돌려 모두 통과했고, `demo.stairnoworks.com`의 시험 앱에도 Middleware를 걸어 두었다(`/` 200, `/svc/readyz` 200).

**남은 것**

- 플랫폼 서버의 조치(구축 09 2차): 조치용 Deployment 고치기(재시작 · 중지/재개)와, 그 고치기를 scale과 재시작 주석으로만 좁히는 검사 규칙. Prometheus 프록시 읽기는 구축 11.
- 배포 실행기 Pod(GoCD Agent) · 자동 등록 키 · 리더 → EC2 GoCD 포트 규칙(구축 09′의 나머지, GoCD 서버가 생긴 뒤), 네임스페이스 라벨 지우기 막기(지금은 서버에 고치기 권한이 없어 필요 없다).

**전체 설계**

1. **권한(RBAC)**: ServiceAccount 둘.
   - **플랫폼 서버**: 클러스터 범위 쓰기는 네임스페이스 만들기 · 삭제 둘뿐이다. 공간 안에서는 ResourceQuota · LimitRange · NetworkPolicy **만들기만**, Secret **만들기 · 고치기만**(`get` · `list` · `watch` 없음), 조치용 Deployment 고치기(재시작 · 중지/재개), 읽기(노드 · Pod 상태, 로그, Prometheus 프록시)를 준다. 서버가 자기 공간의 상한과 차단 규칙을 고치거나 지울 수 있으면, 서버 계정이 털렸을 때 그 제한부터 풀린다.
   - **배포 실행기**: 공간 안 Deployment · Service · Ingress · ConfigMap · Traefik Middleware(`stripPrefix`용, #72) 만들기 · 고치기 · 지우기와, 읽기(Ingress — Prepare의 live 슬롯 보호 검사가 open Ingress를 읽는다 — 와 동작 확인용 Pod · Endpoints · 이벤트 · 롤아웃 상태)만 준다. Secret은 읽지 않는다. 필요한 키가 들어갔는지는 플랫폼 서버가 남긴 키 이름으로 확인한다(값은 보지 않는다). 네임스페이스 · 상한 · 차단 규칙은 건드리지 못한다. 실행기 계정의 토큰은 리더 밖으로 나가지 않는다.
2. **검사 규칙(ValidatingAdmissionPolicy)**: 두 계정 모두 공간 안 쓰기 · 삭제는 `proj-`로 시작하는 공간에서만 통과한다. 네임스페이스는 이름이 `proj-`로 시작하고 보안 등급 라벨이 붙었을 때만 만들어지고, **삭제도 이름이 `proj-`로 시작할 때만** 통과하며, 그 라벨은 지울 수 없다. Pod는 `NET_RAW`를 빼고 API 토큰 자동 마운트를 끈(`automountServiceAccountToken: false`) 것만 통과하고, toleration과 `nodeName`을 달 수 없다. Middleware는 `stripPrefix`만 든 것만 통과한다. 공간의 기본 ServiceAccount는 서버가 고칠 수 없어서(만들기만 가능) 토큰은 Pod마다 끈다. ResourceQuota · LimitRange · NetworkPolicy는 §6 양식과 같은 값일 때만 만들어진다. RBAC만으로는 네임스페이스 이름 조건을 걸 수 없어서 겹친다.

사설망 접근 규칙(Tailscale ACL)은 서버 태그 → 리더 `:6443`, 리더 → EC2의 GoCD 서버 포트(실행기가 일감을 받는 길) 둘만, SSH는 운영자 기기만 허용한다. 규칙은 [`Infra/tailscale/acl.hujson`](../../Infra/tailscale/acl.hujson)이고(주소는 비워 둔다), 2026-11-10에 사설망 관리 화면에 넣었다. 그 전에는 기본 정책(모든 기기가 서로 전부 허용)이었다. 넣은 뒤 확인: 운영자 기기에서 세 노드 SSH와 리더 API는 되고, 노드에서 다른 노드의 사설망 주소로는 닿지 않는다(노드 대역으로는 그대로 닿는다). 리더 → EC2의 GoCD 서버 포트 규칙은 구축 09′에서 더한다. 서버 태그 쪽 규칙은 EC2가 들어와야 확인된다. 서버 접속 정보는 리더의 Secret과 AWS의 비밀 설정에만 둔다(§12).

### 9. 공개 진입 (구현됨, 2026-11-10)

방문자 → Cloudflare(HTTPS) → 리더의 cloudflared가 먼저 걸어 둔 터널 → 워커의 Traefik(HTTP) → 학생 Service. 결정은 [ADR-013](../adr/013-visitor-entry-cloudflare-tunnel.md).

- **도메인**: `stairnoworks.com`(구축 담당 소유, DNS는 Cloudflare). `*.stairnoworks.com`이 터널(`<터널 ID>.cfargotunnel.com`)을 가리키는 프록시 CNAME 하나다. 인증서는 Cloudflare의 무료 인증서(`*.stairnoworks.com` · `stairnoworks.com`)라 한 단계 하위 이름만 HTTPS가 된다.
- **터널**: `wanggane`, 로컬 관리 방식이라 라우팅 규칙이 레포([`Infra/cloudflared/cloudflared.yaml`](../../Infra/cloudflared/cloudflared.yaml)의 ConfigMap)에 있다. `*.stairnoworks.com`은 전부 Traefik(`traefik.kube-system:80`)으로, 나머지는 404. 학생 주소가 하나 늘 때 DNS · 인증서 · 터널은 그대로고 Ingress 하나만 는다.
- **cloudflared**: `cloudflare/cloudflared:2026.10.7`, 리더에 하나(공간 `cloudflared`, 보안 등급 restricted, non-root · 읽기 전용 · capability 없음, API 토큰 없음). 들어오는 통신은 NetworkPolicy로 전부 막는다(지표 포트는 구축 11에서 연다). Pod라서 §3의 호스트 규칙이 아니라 FORWARD의 Pod 대역 허용으로 나간다. 그래서 나가는 길은 이 공간의 NetworkPolicy가 좁힌다: 클러스터 DNS, Traefik Pod의 8000번, 사설 대역을 뺀 인터넷의 7844(TCP · UDP) · 443만. 인터넷 쪽 처리가 리더에서 도는 유일한 프로세스라, 뚫려도 k3s API · kubelet · 이미지 캐시 · 노드 주소에 닿지 않게 한다. 첫 실행에서 QUIC(UDP 7844)으로 연결 넷이 서울(icn06 · icn07)에 붙었다. 준비 검사는 `/ready`(연결이 하나라도 있으면 200)다. 생존 검사는 일부러 두지 않는다: 인터넷 길이 돌아오면 cloudflared가 혼자 다시 붙고(아래 시험), 끊긴 동안 생존 검사가 재시작을 거듭하면 kubelet의 재시작 대기(최대 5분)가 쌓여 오히려 늦게 붙는다.
- **Traefik**: 워커 둘에 하나씩(§4). 터널이 평문 HTTP로 넘기므로 Traefik의 `web` 진입점이 리더 Pod 대역(`10.42.0.0/24`)이 보낸 `X-Forwarded-*`를 믿게 했다. 안 그러면 학생 앱에 `X-Forwarded-Proto: http`가 가서 https로 보내는 앱이 리다이렉트를 반복한다. 확인: 시험 앱이 `X-Forwarded-Proto: https` · `X-Forwarded-Port: 443`을 받는다. 터널을 워커로 옮기면 워커 Pod 대역도 더한다.
- **학생 주소**: 공간 `proj-<slug>` ↔ 주소 `<slug>.stairnoworks.com`. `slug` 규칙은 서버의 것 그대로다([api.md](api.md)). Ingress는 HTTP만 쓴다(TLS는 Cloudflare에서 끝난다). 예시는 [`Infra/student/app-example.yaml`](../../Infra/student/app-example.yaml)의 `demo.stairnoworks.com`.
- **예약 이름**(학생 `slug`로 못 쓴다): 플랫폼 `app` · `api` · `www` · `admin` · `account` · `auth` · `login` · `platform` · `dashboard` · `status` · `docs` · `blog` · `cdn` · `static` · `grafana`, 메일 `mail` · `smtp`, 시험 `demo` · `test` · `dev` · `staging`, 쿠버네티스 `default` · `kube-system`. `demo`는 시험 공간 `proj-demo`라 학생이 쓰면 시험 앱과 겹친다. 막는 것은 서버의 저장 검사고, 목록의 정본은 여기다([api.md](api.md)는 이 목록을 가리킨다).
- **플랫폼 주소**: FE `app.stairnoworks.com`, BE `api.stairnoworks.com`(2026-11-10 정함). 이름을 따로 지정한 레코드가 와일드카드보다 먼저 걸리므로 배포처(CloudFront · EC2)가 생긴 날 레코드를 하나씩 더한다. 그 전에는 와일드카드가 받아 Traefik의 404가 난다.
- **시험(2026-11-10)**: `https://demo.stairnoworks.com` 200(인증서 유효), 없는 이름 404. `http://`도 200이다(Cloudflare의 "Always Use HTTPS"가 꺼져 있다).
- **워커 하나 끄기(2026-11-10)**: 시험 앱이 있던 w1에서 `k3s-killall.sh`로 k3s와 컨테이너를 모두 멈추고 데스크탑에서 1초마다 요청했다. 0~50초 응답 없음(Traefik 둘 다 w1의 앱으로 보낸다. cloudflared가 원본 주소를 찾는 DNS 조회도 w1의 CoreDNS로 가면 시간 초과가 났다), 49초에 NotReady가 되며 w1 쪽 엔드포인트가 빠지고 50~78초는 503(앱 엔드포인트가 비었다), 78초에 w2에 대체 Pod가 생겨 80초부터 200. 방문자가 본 공백은 약 80초다(NotReady 약 50초 + 포기 대기 30초, §4). 앱이 살아 있는 워커에 있었다면 NotReady 전 50초 동안 죽은 워커의 Traefik · CoreDNS로 간 요청만 끊긴다(재지 않았다). 같은 Pod가 다른 노드에 둘 못 뜨는 규칙이라 대체 Traefik · CoreDNS는 w1이 돌아올 때까지 Pending이었고, w1은 k3s를 다시 켠 지 34초 만에 Ready가 됐다. 그 사이(189~270초) 요청 여섯 개가 3초 안에 답을 못 받았는데 cloudflared 로그에는 흔적이 없어 측정 기기와 Cloudflare 사이에서 끊긴 것으로 본다(정상 상태 40번 요청은 모두 200).
- **리더 인터넷 길 끊기(2026-11-10)**: 리더의 기본 경로를 120초 지웠다 다시 붙였다(벽 랜선을 뽑는 것과 같은 효과를 원격으로 낸 것. 노드끼리는 그대로 통한다). 끊긴 동안 방문자는 처음 약 50초 502(Cloudflare가 아직 연결이 있다고 본다), 그다음 530(터널 오프라인)을 받았다. 경로가 돌아오고 Tailscale · SSH는 3초, 터널은 9초 만에 연결 넷이 다시 붙어 11초 뒤 200이 됐다. 사람 손은 들지 않았다. 몇 분 넘게 끊기는 경우와 실제 랜선을 뽑는 경우는 재지 않았다(현장에 갈 때).
- 터널 클라이언트를 워커 둘로 옮겨(같은 터널에 커넥터 둘) 리더가 꺼져도 열리게 하는 것은 후순위다. Pod라서 워커 방화벽은 고칠 것이 없다.

### 10. 지표 (예정)

- Prometheus · Grafana를 리더에(저장은 `local-path`, 보관 2주). 수집: 노드(node-exporter), Pod 사용량(kubelet), 재시작 · 배포 상태(kube-state-metrics), Traefik, cloudflared(터널 커넥터 수).
- 플랫폼 서버는 사설망으로 리더 API의 서비스 프록시를 거쳐 Prometheus를 조회한다(ADR-006). Grafana는 운영자용이고 SSH 포트 포워딩으로만 연다.
- 알림: Grafana 규칙(노드 NotReady, 터널 끊김, 디스크 · 메모리 임계. 터널 끊김은 cloudflared의 연결 수 지표로 보지 않는다: 리더 인터넷을 끊은 시험에서 그 값이 0으로 떨어지지 않았다(§9). `/ready`나 Cloudflare 쪽 상태로 본다) → Discord. 리더가 죽으면 Grafana도 같이 죽으므로 "리더 무응답"은 플랫폼 서버가 API 실패로 알린다.

### 11. 리더 GPU · 로컬 모델 (구현됨, 2026-11-09)

팀 일정상 후순위(2026-11-09 회의)라 데모 경로 밖이다. AI 서버가 부르는 길(EC2 → Tailscale → 리더)은 EC2가 사설망에 들어온 뒤 연다(후순위). 매니페스트는 [`Infra/gpu/`](../../Infra/gpu/) · [`Infra/vllm/`](../../Infra/vllm/)이다.

- GPU: 리더의 RTX 3080(10GB). nvidia-container-toolkit은 받은 PC에 있었고 k3s가 설치 때 `nvidia` 런타임을 잡았다(§4). NVIDIA device plugin v0.20.1을 리더에만 띄워(`runtimeClassName: nvidia`, 리더 taint toleration) 노드에 `nvidia.com/gpu: 1`이 생긴다. 워커 GPU는 학생 Pod가 쓰지 않아 손대지 않는다.
- 모델: Qwen/Qwen3-8B-AWQ(4bit AWQ, 가중치 6.1GB, Apache-2.0), Hugging Face 커밋 `4da05a8`에 고정. 공간 `vllm`의 local-path 볼륨(30Gi)에 Job으로 한 번 받고(학교망 약 47MB/s, 69초), vLLM은 오프라인(`HF_HUB_OFFLINE=1`)으로 읽는다.
- vLLM v0.32.0: 컨텍스트 16K(`--max-model-len 16384`), 동시 요청 1(`--max-num-seqs 1`, 넘치면 대기열), GPU 사용률 0.90, KV 캐시 FP8, 도구 호출 hermes, 생각 파서 qwen3. 생각 모드는 요청에서 끈다(`chat_template_kwargs.enable_thinking: false`).
- KV 캐시가 FP8인 이유: 가중치 5.71GiB를 올리고 나면 fp16 KV 자리가 1.66GiB라 16K 한 요청(약 2.25GiB, 토큰당 약 144KiB)을 못 담아 vLLM이 시작에서 멈춘다. FP8은 토큰당 약 72KiB라 24,352토큰이 들어간다. 동시 요청 수를 줄여도 "최대 길이 요청 하나" 검사는 그대로라 FP8이 필요하다.
- `enableServiceLinks: false`: Service 이름이 `vllm`이라 쿠버네티스가 Pod에 `VLLM_PORT=tcp://…`를 넣고, vLLM이 그걸 자기 설정으로 읽어 시작에서 멈춘다.
- 자리 잡기: 리더 nodeSelector · taint toleration, PriorityClass `wanggane-low`(-100, 남을 밀어내지 않음), CPU 요청 2 · 상한 8, 메모리 요청 12Gi · 상한 32Gi(모델을 올릴 때 컨트롤 플레인이 굶지 않게), `/dev/shm` 4Gi.
- 접근: ClusterIP만. NetworkPolicy로 8000번은 같은 공간에서만 받는다. 공개 주소(터널)에는 붙이지 않는다. API 키는 리더에서 만들어 Secret `vllm-api-key`에 바로 넣는다(값은 화면 · 레포에 남지 않는다).
- 잰 값(2026-11-09, `Infra/vllm/check.yaml`): 키 없음 · 틀린 키 401, 요청 하나 0.4초, 생각 끈 도구 호출 29토큰, 300토큰 요청 셋을 한꺼번에 보내면 2.6 · 5.2 · 7.8초에 차례로, 15.1K 토큰 입력 5.1초(같은 입력을 바로 다시 보내면 앞부분 캐시로 2.4초), 16,385토큰 400, GPU 8.3~8.6GB, 부하 중 API 서버 응답 최대 91ms, 시작 약 52초.

### 12. 비밀값을 두는 곳

값은 레포 · 노션 · 채팅에 올리지 않는다. 반납 때 전부 폐기한다.

| 비밀값 | 두는 곳 |
| --- | --- |
| k3s 서버 토큰 | 리더, 워커 둘의 토큰 파일, 운영자의 비밀번호 관리자 |
| 플랫폼 서버의 클러스터 접속 정보(토큰) | 리더의 클러스터 Secret(`platform` 공간, 원본), AWS 비밀 설정. EC2 설정에 넣을 때만 리더에서 꺼낸다 |
| 서버용 Tailscale 인증 키 | 일회용. 등록 뒤 폐기 |
| 배포 실행기의 GoCD 등록 키 | 리더의 클러스터 Secret (실행기 Pod만 읽는다) |
| GHCR 쓰기 토큰(봇 계정) | 빌드 쪽에만 (ADR-003) |
| Cloudflare 터널 자격 파일 | 리더의 클러스터 Secret(`cloudflared` 공간)만. 터널을 만든 기기에서는 넣은 뒤 지웠고, 계정 로그인 인증서(`cert.pem`)도 남기지 않는다(DNS를 고칠 때 다시 로그인한다) |
| Discord 웹훅 URL | Grafana 설정 |
| vLLM API 키 | 리더의 클러스터 Secret(`vllm` 공간), 팀 공유 보관함(AI 서버의 EC2 설정에 넣는다) |

### 13. 반납

1. Cloudflare 와일드카드 · 플랫폼(`app` · `api`) 레코드 · 터널 삭제(`cert.pem`을 남기지 않았으므로 `cloudflared tunnel login`부터 다시 한다), 위 비밀값 폐기, 서버 기기를 사설망에서 뺀다.
2. 현장에서 한 대씩, 손대기 전에 떠 둔 디스크 이미지로 내장 디스크를 통째로 덮어쓴다. k3s, 공개키, 원격 설치용 설정, Tailscale, 이 문서의 설정 파일이 한 번에 사라진다.
3. BIOS를 바꾸기 전에 찍어 둔 사진대로 되돌리고 장비(스위치 · 랜선)를 회수한다.

## 결정과 대안

| 결정 | 이유 | 버린 대안 |
| --- | --- | --- |
| 노드 주소를 같은 랜 카드에 두 번째 주소로 | 랜 포트가 PC마다 하나라도 된다. 학교 주소가 바뀌어도 클러스터는 그대로 | 학교 주소로 k3s 묶기(주소가 바뀌면 노드끼리 끊긴다), 랜 카드 하나 더(어댑터 · 포트 필요) |
| 노드 주소를 netplan 파일 하나로 따로 | 원래 파일(cloud-init이 만든 것)을 건드리지 않아 되돌리기 쉽다 | `50-cloud-init.yaml` 직접 고치기 |
| 나가는 연결을 포트로 거르기 | ufw가 도메인을 모르고 대상이 CDN 뒤다 | 도메인 허용 목록(별도 프록시 필요), 나가는 연결 전부 허용 |
| 접속을 끊을 수 있는 변경은 되돌리기 예약 뒤에 | 실수하면 동아리방까지 가야 한다 | 그냥 적용 |
| 터널은 리더에서 먼저 | 데모 경로에 필요한 것만 먼저 한다 | 처음부터 워커 둘(워커의 바깥 연결이 하나 늘고 시험이 더 든다) |
| 터널은 로컬 관리 방식, 라우팅 규칙은 레포에 (2026-11-10) | 규칙이 리뷰 · 기록되고 클러스터에 적용된 것과 레포가 같다. 비밀은 자격 파일 하나라 Secret으로만 옮긴다 | 대시보드 관리 방식(규칙이 Cloudflare 화면에만 있고, 토큰 하나로 붙는다) |
| 학생 주소는 한 단계 하위 이름 `<slug>.stairnoworks.com` (2026-11-10) | 무료 인증서가 덮고, 학생 앱이 루트 경로를 가정해도 깨지지 않는다 | 경로 나누기(`/<slug>`, 앱이 깨진다), 두 단계 이름(`<서비스>.<slug>.`, 무료 인증서가 못 덮는다) |
| flannel host-gw, 다음 홉은 노드 주소 (2026-11-07) | VXLAN은 랜 카드의 첫 주소(학교 주소)를 출발지로 써서 방화벽에 막힌다. 세 대가 한 스위치라 경로만으로 된다 | VXLAN 그대로(출발지가 학교 주소), 노드 주소를 랜 카드 첫 주소로 올리기(netplan 적용 순서에 기대서 깨지기 쉽다), 학교 주소에서 8472 허용(학교 주소가 바뀌면 깨진다) |
| ServiceLB 끄기, NodePort는 노드 대역만 (2026-11-07) | hostPort · NodePort가 ufw를 비켜 가서 학교망에 80/443이 열린다. 방문자는 터널로 들어온다 | ServiceLB 그대로(학교망에 Traefik이 열린다) |
| CoreDNS · Traefik은 처음부터 워커 둘에 | 나중에 터널만 옮기면 되고, CoreDNS는 리더가 꺼져도 학생 앱이 바깥 주소(학생 DB 등)를 찾게 한다 | k3s 기본(복제본 1, 리더에 뜰 수 있음) |
| 배포는 리더의 배포 실행기, 플랫폼 서버는 비밀값 · 조치 · 조회만 (2026-11-09, ADR-009) | 배포 쓰기 권한이 클러스터 안에 머물고, 털렸을 때 위험한 서버 계정의 권한이 줄어든다 | 플랫폼 서버가 직접 적용(ADR-004), AWS에 둔 실행기가 사설망 너머로 적용 |
| 로컬 모델의 KV 캐시는 FP8 (2026-11-09) | 10GB에서 16K 한 요청이 들어가는 길. 16K는 AI 쪽 설계값이다 | fp16 그대로(시작 실패), GPU 사용률 0.95(약 2.2GiB로 여전히 모자람), 컨텍스트 12K(설계값을 바꾼다) |
| 로컬 모델 동시 요청 1 (2026-11-09) | 정해진 값이 없었다(AI 쪽 답 없음). 넘치는 요청은 실패하지 않고 줄을 선다 | 3(슬롯 2 + 분석 호출 1로 어림했던 값) |
| 이미지 캐시는 hostNetwork, 노드 주소에만 묶기 (2026-11-10) | 호스트 방화벽이 그대로 걸려 학교 주소 쪽이 닫히고, 노드의 containerd가 고정 주소 하나로 닿는다 | hostPort(DNAT 뒤 FORWARD라 들어오는 거부를 비켜 간다), NodePort(Service · kube-proxy를 거쳐야 하고 포트가 30000번대), 운영 도구 NetworkPolicy로 묶기(호스트에서 오는 연결은 NetworkPolicy로 거르기 어렵다) |
| 이미지 캐시 제품은 CNCF Distribution(`registry`) 끌어오기 모드 (2026-11-10) | 공식 이미지 하나에 설정 파일 하나, 원본이 공개라 자격증명이 없다 | Harbor(DB · Redis 등 구성요소가 많다), k3s 내장 노드끼리 나누기(Spegel, 레지스트리에서 받는 횟수는 줄지만 첫 노드는 늘 바깥에서 받는다) |
| 학생 공간의 API 토큰은 Pod마다 끄고 검사 규칙으로 강제 (2026-11-10) | 서버 계정이 공간 안 객체를 만들기만 하는 설계(§8)를 지킨다. Pod가 덮어쓸 수 없는 검사 규칙이 공간 설정보다 단단하다 | 양식에 `default` ServiceAccount를 넣어 자동 마운트 끄기(서버에 고치기 권한이 필요하고, 공간 생성 직후 쿠버네티스가 만든 것과 부딪혀 `AlreadyExists`가 난다) |
| 학생 공간에 NodePort · LoadBalancer Service 0개 (2026-11-10) | 방문자 길을 Traefik 하나로 묶는다. NodePort는 NetworkPolicy · Traefik을 거치지 않고 노드 대역에 앱을 연다 | 노드 대역 제한(§4)만 믿기 |
| 양식 값은 검사 규칙에 베끼지 않고 기준 공간과 비교 (2026-11-10) | 양식 파일 하나만 고치면 된다. 규칙 안에 값을 다시 적으면 둘이 어긋난다 | 규칙에 값을 직접 적기(상한 11개 · 차단 대역 5개를 두 군데서 관리), 값 검사 없이 권한만(서버 계정이 느슨한 상한을 만들 수 있다) |
| 서버의 읽기는 공간마다 권한 연결로 (2026-11-10) | 서버 토큰은 클러스터 밖(EC2)에 있다. 새더라도 학생 공간 밖의 Pod · 로그(Traefik 접근 기록, 로컬 모델 요청 등)는 읽히지 않는다 | 클러스터 전체 읽기(서버가 만드는 객체는 하나 줄지만 시스템 공간까지 읽힌다) |
| 실행기의 권한은 공간마다 권한 연결 하나로, 서버가 공간과 같이 만든다 (2026-11-11) | 실행기는 GoCD 서버가 시키는 명령을 그대로 돌린다. 클러스터 전체 권한이 없으면 GoCD 서버가 털려도 학생 공간 밖은 읽히지도 쓰이지도 않는다. `kubectl apply`가 읽기를 먼저 하므로 쓰기만 따로 넓게 줄 이유가 없다 | 쓰기는 클러스터 전체에 주고 검사 규칙으로 좁히기 + 읽기만 공간마다(연결은 똑같이 필요하고 권한만 넓다), 읽기까지 클러스터 전체(서버가 만드는 객체는 하나 줄지만 시스템 공간의 ConfigMap · Pod가 읽힌다), 실행기가 자기 연결을 만들기(RoleBinding 권한이 실행기에 생긴다) |
| 실행기에 Traefik Middleware 권한, `stripPrefix`만 (2026-11-11, #72) | 학생 백엔드마다 받는 경로가 달라(`/api/usr` 대 `/usr`) 배포 입력의 `stripPrefix`가 동작해야 하고, Ingress만으로는 안 된다. 종류를 하나로 묶어 리다이렉트 · 인증 가로채기를 막는다 | 권한을 주지 않고 `stripPrefix: true`를 입력 검증에서 거부(학생 앱이 경로를 고쳐야 한다), Middleware 종류 제한 없이 허용 |
| 서버 계정의 Secret 권한은 만들기와 통째로 바꾸기만 (2026-11-10) | patch 응답이 Secret 전체라 "쓰기만"이 깨진다 | patch 허용(빈 patch로 읽힌다), server-side apply(patch 권한이 필요하다) |
| 서버 계정 토큰은 만료 없는 것 하나 (2026-11-10) | 대회 기간에 갱신할 인증 정보를 두지 않는다. 폐기는 Secret 삭제로 한다 | 기한 있는 토큰(`kubectl create token`. 만료 전에 EC2 설정을 다시 넣어야 하고, 개별 폐기가 안 된다) |
| 학생 DB는 학생 것, 학생 Pod는 인터넷으로 나간다 (2026-11-07) | 배포 구조 v15에서 MVP 범위를 줄였다. 클러스터에 학생 데이터가 없어 볼륨 복제 · 페일오버 시험이 빠진다 | 플랫폼 MySQL + Longhorn 사본 2(이전 계획), 학생 DB 주소만 허용하는 egress(주소를 미리 알 수 없다) |

## 알려진 한계

- 리더, 스위치, 벽 랜 포트(인터넷 길)가 단일 장애점이다. 스위치 전원이 잠깐 나가면 돌아오는 순간 학생 Pod가 전부 다시 뜬다.
- 터널이 리더에 있는 동안은 리더가 꺼지면 방문자가 들어오지 못한다.
- 워커 하나가 꺼지면 그 워커에 있던 학생 주소는 약 80초 동안 열리지 않는다(§9에서 잼). 앱 복제본이 1개라 다른 워커에 다시 뜰 때까지 기다린다.
- Traefik은 리더 Pod 대역에서 온 `X-Forwarded-*`를 그대로 넘긴다. Cloudflare는 방문자가 보낸 `X-Forwarded-For`에 실제 주소를 덧붙이므로 맨 앞 값은 방문자가 지어낼 수 있다. 방문자 주소가 필요한 학생 앱은 `Cf-Connecting-Ip`를 쓴다. 리더의 다른 운영 도구 Pod도 Traefik에 직접 이 머리글을 보낼 수 있다(리더에는 학생 Pod가 뜨지 않는다).
- 믿는 대역 `10.42.0.0/24`는 k3s가 리더를 등록할 때 준 Pod 대역이다(`kubectl get node k3s-leader -o jsonpath={.spec.podCIDR}`). 리더를 다시 붙이거나 새로 세우면 바뀔 수 있으니 [`Infra/k3s/traefik-config.yaml`](../../Infra/k3s/traefik-config.yaml)을 같이 고친다. 안 고치면 학생 앱이 다시 http로 보인다.
- "Always Use HTTPS"를 켜기 전에는 학생 주소가 `http://`로도 열린다.
- 사설망이 지금 중계(DERP)로 붙어 서버 → 리더 API 응답이 직접 연결보다 느리다.
- 나가는 443은 목적지를 가리지 않는다. 워커 호스트가 뚫리면 443으로는 어디든 나갈 수 있다.
- 학생 Pod가 인터넷으로 나가므로 학생 앱이 학교 공인 IP로 바깥에 요청을 보낼 수 있다(남용은 감수한다). 사설 대역 차단이 빠지면 학교망 · 노드 · 사설망에 닿으므로 NetworkPolicy의 예외 대역을 같이 적는다.
- Secret을 "쓰기만" 줘도 간접 읽기는 막지 못한다. 배포 실행기 계정이 털리면 `proj-` 공간에 그 Secret을 마운트하는 Pod를 띄울 수 있다. 실행기는 Pod 로그를 읽지 못하지만(§8), 그 Pod가 값을 인터넷으로 내보내거나 자기 Ingress 응답에 실으면 읽힌다. 플랫폼 서버 계정도 조치용 Deployment 고치기 권한(구축 09 2차, 아직 없다)을 받으면 같은 길이 생긴다(조치를 scale과 재시작 주석으로만 좁히는 검사 규칙을 그때 본다). 공간에 든 Secret은 그 학생 앱의 접속 정보뿐이라 한 프로젝트 안으로 피해가 묶이고, 다른 공간과 시스템 Secret은 검사 규칙으로 닿지 않는다. 서버 접속 정보를 AWS 비밀 설정에, 실행기 토큰을 리더 안에만 두는 것이 1차 방어다.
- Pod 대역(`10.42.0.0/16`)으로 가는 패킷은 FORWARD에서 받는다(k3s 기본 flannel 규칙과 같다). 같은 선의 학교망 기기가 노드를 경로로 지정하면 Pod에 닿을 수 있다. 학생 Pod는 NetworkPolicy(§6)의 들어오는 규칙이 막지만, 시스템 Pod(CoreDNS · Traefik 등)는 아직 NetworkPolicy가 없어 이 길로 닿는다. 운영 도구 Pod의 NetworkPolicy(§3)를 넣을 때 들어오는 쪽도 같이 막는다.
- 터널 대신 AWS 서버를 공개 입구로 두고 Tailscale로 워커 Traefik에 넘기는 대안을 쓰게 되면 ServiceLB가 없어 Traefik으로 가는 길을 따로 연다.
- 로컬 모델은 리더에 있어 리더가 꺼지면 제어 · 모니터링과 같이 멈춘다. KV 캐시를 FP8로 저장해 fp16보다 정확도가 조금 떨어질 수 있다(시험한 도구 호출 · 로그 요약은 맞았다).
- 이미지 캐시가 처음 받는 이미지는 GHCR에서 직접 받을 때보다 느렸다(같은 이미지 1분 53초 대 44초, 한 번 잼). 학교망에서 GHCR이 느린 데다 캐시가 받으며 넘겨주는 동안 기다린다. 두 번째 노드부터는 1초대다. 데모 전에 쓸 이미지를 한 번 받아 두면 피한다.
- 이미지 캐시는 리더에 하나뿐이다. 캐시에 닿지 않으면 노드는 이미지를 받을 때마다 연결 시간 초과 30초를 먼저 기다린 뒤 GHCR에서 직접 받는다(5000번 DROP으로 흉내 내 잼, 리더 전원을 끈 시험은 아니다). 캐시에 받아 둔 것은 7일 뒤 지워진다.
- 캐시 볼륨의 50Gi는 상한이 아니다. local-path는 크기를 막지 않고 캐시에도 크기 제한이 없어, 7일 안에 큰 이미지를 많이 받으면 리더 디스크(etcd · 모델 볼륨과 같은 디스크)를 계속 차지한다. 지금 리더 여유는 약 760G다. 리더 디스크 알림(구축 11)으로 본다.
- 리더 taint는 toleration을 단 Pod와 `nodeName`을 적은 Pod를 막지 못한다. `proj-` 공간에서는 검사 규칙 `wanggane-student-pods`가 둘 다 거절한다(§8, 2026-11-11). `proj-` 밖 공간에는 이 규칙이 걸리지 않는다(학생 계정도 실행기도 거기에 쓰지 못한다).
- 실행기 계정은 자기 공간의 Ingress에 어떤 호스트와 Traefik 주석이든 적을 수 있다. 다른 프로젝트의 주소(`<다른 slug>.stairnoworks.com`)를 적은 Ingress나 다른 공간의 Middleware를 가리키는 주석을 검사 규칙이 막지 않는다. 지금은 차트가 Ingress를 만들고 `proj-` 밖에는 Middleware가 없어 괜찮다. 실행기가 받는 값(GoCD 서버)이 털렸을 때의 길이다.
- 플랫폼 서버 계정은 공간만 만들고 상한 · 차단 규칙을 만들지 않을 수 있다. 검사 규칙은 만들어지는 것의 값만 본다. 서버 계정은 Pod를 만들 수 없어 그 공간에 앱이 뜨려면 배포 실행기를 거쳐야 하므로, 실행기가 배포 전에 셋이 있는지 확인하는 것을 구축 09′에서 본다.
- 서버 계정의 권한(RBAC)은 클러스터 전체에 걸려 있고, `proj-` 공간으로 좁히는 것은 검사 규칙뿐이다. 검사 규칙이 없거나 경고 모드인 동안에는 이 계정으로 어느 공간의 Secret이든 쓰고 네임스페이스를 지울 수 있다. 그래서 검사 규칙을 먼저 적용하고 계정을 나중에 만들며, 없앨 때는 계정부터 지운다. 서버 계정에 걸린 규칙은 계정이 있는 동안 경고 모드로 내리지 않는다. 시험 스크립트도 실제 객체(`vllm` 등)를 겨누는 거절 시험은 dry run으로 보낸다.
- 양식 값 비교는 저장된 모양 그대로의 문자열 비교다. 값이 같아도 단위가 다르면(`16Gi` 대신 `17179869184`) 거절된다. 서버는 양식 파일의 글자를 그대로 보낸다.
- 기준 공간 `student-template`의 객체가 하나라도 없어지면 그 종류(상한 · 기본값 · 차단 규칙 · 권한 연결)는 클러스터 어디서도 만들 수 없다. 닫히는 쪽으로 실패하지만 다른 설치(구축 11의 모니터링 등)도 같이 막힌다. 기준 공간을 다시 적용하면 풀린다.
- 서버가 읽는 Pod 스펙에는 환경 변수 이름과 Secret 참조가 보인다(값은 아니다). 로그에 학생 앱이 찍은 값은 그대로 읽힌다.
- 서버 계정의 토큰은 만료가 없다. 새면 리더에서 Secret을 지워 폐기하고 다시 만든다.
- 프로젝트 자원 상한은 기본값 컨테이너 4개분이라, 한 프로젝트에서 두 서비스를 동시에 배포하면 하나가 기다린다(§6).
