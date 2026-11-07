# 클러스터 — 설계

- **상태**: 일부 구현됨 (노드 · 네트워크 · 방화벽 2026-11-06, k3s 설치 2026-11-07). 이미지 캐시부터는 초안
- **관련**: SRS NFR-OPS-01 · NFR-SEC-01 · [ADR-003](../adr/003-registry-ghcr.md) 레지스트리 · [ADR-004](../adr/004-server-cluster-link-tailscale.md) 서버 연결 · [ADR-005](../adr/005-k3s-cluster-on-school-pcs.md) 클러스터 구성 · [ADR-006](../adr/006-metrics-on-leader-prometheus.md) 지표 · [ADR-008](../adr/008-node-network-on-school-wired-lan.md) 노드망 · [ADR-009](../adr/009-deploy-runs-on-leader-gocd-agent.md) 배포 실행기 · [시스템 정의서 §5](../system-definition.md#5-인프라) · 구축 task [`20261106-k3s-cluster-build`](../../tasks/active/20261106-k3s-cluster-build-todo.md)

## 범위

- **한다**: 학교 PC 3대(리더 1 + 워커 2)의 노드 설정, 노드 망 · 방화벽, k3s 설치 옵션, 학생 공간 양식(네임스페이스 · 자원 상한 · 네트워크 정책 · 보안 등급), 플랫폼 서버와 리더의 배포 실행기에 주는 권한, 이미지 캐시, 공개 진입, 지표 수집, 비밀값을 두는 곳, 반납.
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
| 나감 (리더만) | 7844 (tcp · udp) | Cloudflare Tunnel |
| 거쳐 감 (FORWARD) | 출발지 또는 목적지 `10.42.0.0/16` | Pod 통신. NetworkPolicy(k3s의 kube-router)가 이보다 앞에서 걸린다 |

- 나가는 쪽을 도메인이 아니라 포트로 거르는 것은 ufw가 도메인을 모르고, 레지스트리 · 패키지 저장소 · Tailscale이 CDN 뒤라 IP가 바뀌기 때문이다.
- 이 표는 **호스트 프로세스**(containerd, k3s, Tailscale, apt 등)에만 걸린다. Pod에서 나가는 통신은 NAT 뒤 FORWARD 체인을 타서 이 표가 적용되지 않는다. 그래서 학생 Pod는 NetworkPolicy(§6)로 막고, 운영 도구 Pod(cloudflared · 이미지 캐시 · CoreDNS의 바깥 DNS 질의)는 띄울 때(07 · 10) 필요한 목적지 · 포트만 여는 NetworkPolicy로 따로 묶는다(05에서 본 FORWARD 동작은 아래). 그 전까지 "리더만 7844"는 호스트 기준이다.
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
- Traefik(k3s 기본 Ingress)은 `HelmChartConfig`로 워커에만, 복제본 2로 둔다. 하나뿐이면 그 워커가 죽을 때 터널이 보낼 곳이 없다.
- k3s 토큰(서버 토큰)은 리더에 있고, 조인에 쓴 사본이 워커 둘의 `/etc/rancher/k3s/token`(권한 600)에도 있다. 레포 · 노션 · 채팅에는 올리지 않고, 운영자가 비밀번호 관리자에 사본을 둔다. 서버 토큰은 워커뿐 아니라 리더로도 붙을 수 있는 열쇠라서, 학생 앱을 받기 전(08)에 워커에는 워커 전용 `agent-token`을 줄지 정한다.

### 5. 이미지 (예정)

- 리더에 GHCR 끌어오기 캐시(pull-through) 저장소를 둔다. 저장은 리더 로컬 디스크(local-path).
- 세 노드의 containerd가 `ghcr.io`를 리더 캐시(`192.168.77.11:5000`)에서 먼저 받고, 캐시가 죽으면 GHCR에서 직접 받는다(`registries.yaml`의 mirror). 이미지가 공개라 노드에 자격증명이 없다(ADR-003).

### 6. 학생 공간 양식 (예정)

프로젝트마다 만드는 공간의 틀. 공간 · 보안 등급 · 자원 상한 · 차단 규칙은 플랫폼 서버가 처음에 만들고, 앱 자원(Deployment · Service · Ingress)은 리더의 배포 실행기가 배포 설정에서 값을 뽑아 채운다.

| 항목 | 값 |
| --- | --- |
| 이름 | `proj-<id>` |
| 보안 등급 | Pod Security `enforce=baseline`, `warn=restricted`. restricted로 강제하면 root로 도는 공식 이미지(nginx · node 등)가 거절된다 |
| 컨테이너 권한 | 모든 컨테이너에서 `NET_RAW` capability를 뺀다(`securityContext.capabilities.drop: ["NET_RAW"]`). baseline은 이걸 빼지 않아, 같은 워커의 학생 Pod가 ARP 스푸핑으로 다른 Pod 통신을 가로챌 수 있다. 배포 실행기가 매니페스트에 넣고, 검사 규칙(§8)이 빠진 Pod를 거절한다 |
| 배치 | 워커에만(라벨 + 리더 taint). 앱 복제본 1 |
| 프로젝트 자원 상한 (ResourceQuota) | **제안** CPU 요청 4 · 상한 8, 메모리 요청 16Gi · 상한 32Gi, 볼륨 요청 0(학생 볼륨 없음), Pod 10개. 워커 하나(24스레드 · 125GiB)의 절반 아래로, 워커가 하나 꺼져 두 프로젝트가 한 워커에 떠도 시스템 몫이 남는다. 플랫폼 서버 담당과 확인한 뒤 확정한다 |
| 컨테이너 기본값 (LimitRange) | **제안** 요청 CPU 250m · 메모리 256Mi, 상한 CPU 2 · 메모리 4Gi(스펙에 값이 없을 때) |
| 들어오는 통신 (NetworkPolicy) | 같은 공간, Ingress(Traefik)에서만 |
| 나가는 통신 (NetworkPolicy) | 같은 공간, 클러스터 DNS, 인터넷(학생 DB가 밖에 있다). 학교망 `10.198.0.0/16`, 클러스터 내부(`10.42.0.0/16` · `10.43.0.0/16`, DNS 빼고), 노드 대역 `192.168.77.0/24`, Tailscale `100.64.0.0/10`, 그 밖의 사설 대역, 다른 학생 공간은 막는다 |
| 노드가 꺼졌을 때 | 약 50초 뒤 NotReady가 되고(2026-11-08 잼), 포기 대기 30초(기본 5분)가 지나 약 80초에 남은 워커에 다시 띄운다. 포기 대기 값은 API 서버에서 한 번에 준다(§4). 서버 양식에 따로 넣지 않는다 |
| DB | 학생 것(MVP). 학생이 넣은 접속 정보를 Secret으로 환경 변수에 주입한다. 클러스터에 DB와 볼륨을 두지 않는다 |

### 7. 학생 볼륨 (빠짐)

- 학생 DB가 학생 것으로 바뀌어(2026-11-07, 배포 구조 v15) 학생 볼륨을 두지 않는다. Longhorn, 노드 다운 시 Pod 삭제 정책, 볼륨 크기 상한, 볼륨 방식 ADR이 모두 빠졌다.
- 저장 클래스는 k3s 기본 `local-path` 하나다. 리더에 두는 것(이미지 캐시, Prometheus, Grafana)은 리더 로컬 디스크를 쓴다.
- 워커가 꺼지면 학생 앱만 남은 워커에 다시 뜬다(§6 "노드가 꺼졌을 때"). 데이터는 학생 DB에 있어 따라갈 것이 없다.

### 8. 플랫폼 서버와 배포 실행기의 권한 (예정, 구축 09 · 09′에서 확정)

배포는 리더의 배포 실행기(GoCD Agent)가 하고, 플랫폼 서버는 비밀값 · 조치 · 조회만 한다([ADR-009](../adr/009-deploy-runs-on-leader-gocd-agent.md)). 계정을 둘로 나누고 두 겹으로 막는다.

1. **권한(RBAC)**: ServiceAccount 둘.
   - **플랫폼 서버**: 클러스터 범위 쓰기는 네임스페이스 만들기 · 삭제 둘뿐이다. 공간 안에서는 ResourceQuota · LimitRange · NetworkPolicy **만들기만**, Secret **만들기 · 고치기만**(`get` · `list` · `watch` 없음), 조치용 Deployment 고치기(재시작 · 중지/재개), 읽기(노드 · Pod 상태, 로그, Prometheus 프록시)를 준다. 서버가 자기 공간의 상한과 차단 규칙을 고치거나 지울 수 있으면, 서버 계정이 털렸을 때 그 제한부터 풀린다.
   - **배포 실행기**: 공간 안 Deployment · Service · Ingress · ConfigMap 만들기 · 고치기 · 지우기와, 동작 확인용 읽기(Pod · Endpoints · 이벤트 · 롤아웃 상태)만 준다. Secret은 읽지 않는다. 필요한 키가 들어갔는지는 플랫폼 서버가 남긴 키 이름으로 확인한다(값은 보지 않는다). 네임스페이스 · 상한 · 차단 규칙은 건드리지 못한다. 실행기 계정의 토큰은 리더 밖으로 나가지 않는다.
2. **검사 규칙(ValidatingAdmissionPolicy)**: 두 계정 모두 공간 안 쓰기 · 삭제는 `proj-`로 시작하는 공간에서만 통과한다. 네임스페이스는 이름이 `proj-`로 시작하고 보안 등급 라벨이 붙었을 때만 만들어지고, **삭제도 이름이 `proj-`로 시작할 때만** 통과하며, 그 라벨은 지울 수 없다. Pod는 `NET_RAW`를 뺀 것만 통과한다. ResourceQuota · LimitRange · NetworkPolicy는 §6 양식과 같은 값일 때만 만들어진다. RBAC만으로는 네임스페이스 이름 조건을 걸 수 없어서 겹친다.

사설망 접근 규칙(Tailscale ACL)은 서버 태그 → 리더 `:6443`, 리더 → EC2의 GoCD 서버 포트(실행기가 일감을 받는 길) 둘만, SSH는 운영자 기기만 허용한다. 서버 접속 정보는 AWS의 비밀 설정에만 둔다.

### 9. 공개 진입 (예정)

- Cloudflare Tunnel. 와일드카드 도메인을 터널로 보내고 학생 주소는 `이름.<도메인>`(소문자 영숫자 · 하이픈만)으로 연다. 도메인은 구축 담당이 가진 `stairnoworks.com`을 쓸 계획이지만, 연결 범위 · 비용은 [시스템 정의서 §6](../system-definition.md#열린-질문) 열린 질문 5에서 팀이 정한다. 예약 이름(`www` · `api` · `admin` · `mail` 등)은 학생이 못 쓴다.
- 터널 클라이언트(cloudflared)는 지금은 리더에서 돈다. 그래서 리더가 꺼지면 방문자도 끊긴다. 워커 둘로 옮겨(같은 터널에 커넥터 둘) 리더가 꺼져도 열리게 하는 것은 후순위다. 그때 워커의 나가는 규칙에 7844를 더한다.
- 목적지는 워커의 Traefik이다. 터널 토큰은 클러스터 Secret에만 둔다.

### 10. 지표 (예정)

- Prometheus · Grafana를 리더에(저장은 `local-path`, 보관 2주). 수집: 노드(node-exporter), Pod 사용량(kubelet), 재시작 · 배포 상태(kube-state-metrics), Traefik, cloudflared(터널 커넥터 수).
- 플랫폼 서버는 사설망으로 리더 API의 서비스 프록시를 거쳐 Prometheus를 조회한다(ADR-006). Grafana는 운영자용이고 SSH 포트 포워딩으로만 연다.
- 알림: Grafana 규칙(노드 NotReady, 터널 커넥터 0개, 디스크 · 메모리 임계) → Discord. 리더가 죽으면 Grafana도 같이 죽으므로 "리더 무응답"은 플랫폼 서버가 API 실패로 알린다.

### 11. 비밀값을 두는 곳

값은 레포 · 노션 · 채팅에 올리지 않는다. 반납 때 전부 폐기한다.

| 비밀값 | 두는 곳 |
| --- | --- |
| k3s 서버 토큰 | 리더, 워커 둘의 토큰 파일, 운영자의 비밀번호 관리자 |
| 플랫폼 서버의 클러스터 접속 정보 | AWS 비밀 설정 |
| 서버용 Tailscale 인증 키 | 일회용. 등록 뒤 폐기 |
| 배포 실행기의 GoCD 등록 키 | 리더의 클러스터 Secret (실행기 Pod만 읽는다) |
| GHCR 쓰기 토큰(봇 계정) | 빌드 쪽에만 (ADR-003) |
| Cloudflare 터널 토큰 | 클러스터 Secret |
| Discord 웹훅 URL | Grafana 설정 |

### 12. 반납

1. Cloudflare 와일드카드 · 터널 삭제, 위 비밀값 폐기, 서버 기기를 사설망에서 뺀다.
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
| flannel host-gw, 다음 홉은 노드 주소 (2026-11-07) | VXLAN은 랜 카드의 첫 주소(학교 주소)를 출발지로 써서 방화벽에 막힌다. 세 대가 한 스위치라 경로만으로 된다 | VXLAN 그대로(출발지가 학교 주소), 노드 주소를 랜 카드 첫 주소로 올리기(netplan 적용 순서에 기대서 깨지기 쉽다), 학교 주소에서 8472 허용(학교 주소가 바뀌면 깨진다) |
| ServiceLB 끄기, NodePort는 노드 대역만 (2026-11-07) | hostPort · NodePort가 ufw를 비켜 가서 학교망에 80/443이 열린다. 방문자는 터널로 들어온다 | ServiceLB 그대로(학교망에 Traefik이 열린다) |
| CoreDNS · Traefik은 처음부터 워커 둘에 | 나중에 터널만 옮기면 되고, CoreDNS는 리더가 꺼져도 학생 앱이 바깥 주소(학생 DB 등)를 찾게 한다 | k3s 기본(복제본 1, 리더에 뜰 수 있음) |
| 배포는 리더의 배포 실행기, 플랫폼 서버는 비밀값 · 조치 · 조회만 (2026-11-09, ADR-009) | 배포 쓰기 권한이 클러스터 안에 머물고, 털렸을 때 위험한 서버 계정의 권한이 줄어든다 | 플랫폼 서버가 직접 적용(ADR-004), AWS에 둔 실행기가 사설망 너머로 적용 |
| 학생 DB는 학생 것, 학생 Pod는 인터넷으로 나간다 (2026-11-07) | 배포 구조 v15에서 MVP 범위를 줄였다. 클러스터에 학생 데이터가 없어 볼륨 복제 · 페일오버 시험이 빠진다 | 플랫폼 MySQL + Longhorn 사본 2(이전 계획), 학생 DB 주소만 허용하는 egress(주소를 미리 알 수 없다) |

## 알려진 한계

- 리더, 스위치, 벽 랜 포트(인터넷 길)가 단일 장애점이다. 스위치 전원이 잠깐 나가면 돌아오는 순간 학생 Pod가 전부 다시 뜬다.
- 터널이 리더에 있는 동안은 리더가 꺼지면 방문자가 들어오지 못한다.
- 사설망이 지금 중계(DERP)로 붙어 서버 → 리더 API 응답이 직접 연결보다 느리다.
- 나가는 443은 목적지를 가리지 않는다. 워커 호스트가 뚫리면 443으로는 어디든 나갈 수 있다.
- 학생 Pod가 인터넷으로 나가므로 학생 앱이 학교 공인 IP로 바깥에 요청을 보낼 수 있다(남용은 감수한다). 사설 대역 차단이 빠지면 학교망 · 노드 · 사설망에 닿으므로 NetworkPolicy의 예외 대역을 같이 적는다.
- Secret을 "쓰기만" 줘도 간접 읽기는 막지 못한다. 배포 실행기 계정이 털리면 `proj-` 공간에 그 Secret을 마운트하는 Pod를 띄우고 로그로 값을 읽을 수 있다. 플랫폼 서버 계정도 조치용으로 Deployment를 고칠 수 있어 같은 길이 남는다(조치를 scale과 재시작 주석으로만 좁히는 검사 규칙은 09에서 본다). 공간에 든 Secret은 그 학생 앱의 접속 정보뿐이라 한 프로젝트 안으로 피해가 묶이고, 다른 공간과 시스템 Secret은 검사 규칙으로 닿지 않는다. 서버 접속 정보를 AWS 비밀 설정에, 실행기 토큰을 리더 안에만 두는 것이 1차 방어다.
- Pod 대역(`10.42.0.0/16`)으로 가는 패킷은 FORWARD에서 받는다(k3s 기본 flannel 규칙과 같다). 같은 선의 학교망 기기가 노드를 경로로 지정하면 Pod에 닿을 수 있다. 학생 Pod는 NetworkPolicy(§6)의 들어오는 규칙이 막지만, 시스템 Pod(CoreDNS · Traefik 등)는 아직 NetworkPolicy가 없어 이 길로 닿는다. 운영 도구 Pod의 NetworkPolicy(§3)를 넣을 때 들어오는 쪽도 같이 막는다.
- 터널 대신 AWS 서버를 공개 입구로 두고 Tailscale로 워커 Traefik에 넘기는 대안을 쓰게 되면 ServiceLB가 없어 Traefik으로 가는 길을 따로 연다.
- 위의 **제안** 값(프로젝트 자원 상한, 컨테이너 기본값)은 플랫폼 서버 담당과 확인 전이다.
