# ADR-002: 학생 프로젝트는 R2 또는 k3s 클러스터(학교 PC 우선, 클라우드 VM 예비)에서 실행한다

- **상태**: 제안됨
- **날짜**: 2026-10-26
- **결정자**: TBD (초안: @seren-wib, 팀 합의 전)
- **관련**: [`001-stack.md`](001-stack.md), [`design.md`](../design.md) §1 (구성도·구성 요소·흐름), [`hackathon.md`](../hackathon.md)

## 맥락

서비스는 학교 실습실에서 놀고 있는 PC를 묶어 학생 프로젝트를 대신 실행한다. 실행 위치와 연결 방식을 정해야 하는 이유는 네 가지다.

- 학교 PC는 학교 방화벽 안에 있어 밖에서 바로 접속할 수 없다.
- 학교 PC는 수업 시간에만 켜져 있고, 수업 중에는 사람이 쓴다.
- 학생 코드는 신뢰할 수 없는 코드다. 실행할 때만이 아니라 빌드할 때도 그렇고, 한 PC에 여러 학생의 코드가 같이 돈다.
- 배포 URL은 제출 마감(11.15 18:00)부터 심사(11.21)까지 살아 있어야 한다. 그 사이 학교 PC가 꺼져 있어도 시연이 되어야 한다.

## 결정

업로드된 프로젝트를 LLM이 분석해 정적 / 브라우저 실행 / 서버 필요로 분류하고 위험 코드를 표시한다. 빌드는 k3s 빌드 Job(rootless BuildKit)이 맡는다. 정적·브라우저 실행 프로젝트는 빌드 결과를 Cloudflare R2에 올려 학생 결과물 도메인으로 바로 공개한다. 서버 필요 프로젝트는 이미지를 GHCR에 올리고, k3s 서버가 Deployment와 Ingress를 만들어 켜져 있는 학교 PC에 우선 배치한다. 학교 PC가 하나도 없으면 클라우드 VM 노드에 배치한다. 요청은 VM의 Traefik(k3s 내장 Ingress)이 받아 Tailscale 사설망 위로 Pod에 전달한다. 우리 서비스의 api(FastAPI)도 같은 클러스터 안에서 VM 노드에 고정해 돌린다.

배치 규칙:

- VM은 k3s 서버이면서 예비 워커다. 학교 PC는 전부 에이전트 노드다.
- api, Traefik, 빌드 Job은 `nodeSelector`로 VM 노드에 고정한다.
- 학생 Pod는 `required nodeAffinity`로 학교 PC 노드에만 배치한다. VM 노드에는 `NoSchedule` taint를 두고 학생 Pod는 기본적으로 이를 허용하지 않는다. Ready인 학교 PC가 하나도 없을 때만 api가 그 Deployment의 affinity를 학교 PC 조건에서 VM 노드 조건으로 교체하고 VM toleration을 붙인다(둘을 같이 두면 조건이 충돌해 어디에도 배치되지 않는다). 학교 PC가 돌아오면 api의 주기 작업이 affinity를 학교 PC 조건으로 되돌리고 toleration을 뗀다. `preferred nodeAffinity`는 점수일 뿐이라 학교 PC가 있어도 VM에 갈 수 있어 쓰지 않는다.
- GHCR는 private이다. 모든 노드의 k3s `registries.yaml`에 읽기 전용 토큰(`read:packages`)을 넣어 노드 단위로 인증한다. 학교 PC 참여 스크립트가 이 파일을 만들고, 토큰 교체도 같은 스크립트를 다시 돌려서 한다. 이미지를 올리는 쪽은 따로다. 빌드 네임스페이스에 `write:packages` 토큰을 담은 Secret을 두고 빌드 Job에만 마운트한다. 토큰은 VM을 세팅하는 사람이 GitHub에서 만들어 `kubectl create secret`으로 넣고, 교체는 새 토큰으로 Secret을 다시 만든 뒤 이전 토큰을 GitHub에서 폐기하는 것으로 한다(Secret만 바꿔서는 이전 토큰이 살아 있다). 서비스를 접을 때는 Secret과 토큰을 둘 다 지운다. 노드 토큰은 읽기 전용으로 유지하고, 값은 어느 쪽도 레포에 커밋하지 않는다.
- 노드가 NotReady가 되면 `tolerationSeconds`를 30초로 줄여 eviction을 빨리 시작한다(기본 5분). 이건 전체 복구 시간이 아니다. NotReady 감지(기본 40초), 재스케줄, 이미지 pull, readiness까지 더한 실제 복구 시간은 PC를 실제로 꺼서 재고 [`design.md`](../design.md) §7에 적는다.
- 학교 PC 켜짐 여부는 k3s 노드의 Ready 상태를 그대로 쓴다. api는 이 값을 읽기만 하고 따로 핑을 보내지 않는다.

실행 격리: 학생 코드가 도는 네임스페이스에 Pod Security Admission `restricted`를 강제한다. 그러면 non-root, 호스트 네임스페이스·호스트 경로 금지, 권한 상승 금지, capabilities 전부 drop, seccomp `RuntimeDefault`가 필수가 된다. 거기에 `automountServiceAccountToken: false`, 권한 없는 ServiceAccount, Pod 간 통신을 막는 NetworkPolicy를 더한다. 학생 Pod의 egress는 클러스터 DNS(53)와 인터넷만 허용하고, 클러스터 내부 대역·Tailscale 대역·클라우드 메타데이터 주소(169.254.169.254)는 NetworkPolicy의 `ipBlock`/`except`로 막는다. Pod가 자기 노드로 가는 경로는 NetworkPolicy가 보장하지 않으므로 노드의 호스트 방화벽(nftables)에서 Pod 대역 → 노드 주소를 따로 막고, 실제로 막히는지는 측정한다([`design.md`](../design.md) §7 6번). 커널은 공유하므로 완전한 격리는 아니고, gVisor 같은 샌드박스 런타임은 이후 확장이다.

빌드 격리: 학생 Dockerfile의 `RUN`은 임의 코드 실행이다. 그래서 빌드를 VM 호스트의 Docker 데몬에서 돌리지 않고 k3s Job 안의 rootless BuildKit으로 돌린다. Job에도 학생 Pod와 같은 실행 격리 기준과 requests/limits를 걸고, egress는 클러스터 DNS(53), GHCR, Docker Hub(베이스 이미지), 패키지 저장소, R2 엔드포인트만 허용한다. 이 목록은 도메인 단위인데 NetworkPolicy는 IP만 다루므로, 빌드 네임스페이스에 허용 목록을 가진 HTTP 프록시를 두고 Job의 `HTTP_PROXY`/`HTTPS_PROXY`로 모든 나가는 연결을 그리로 보낸다. NetworkPolicy는 프록시와 DNS 외의 egress를 전부 막는 데만 쓴다.

구성도, 구성 요소별 역할, 흐름, 아직 정하지 않은 항목은 [`design.md`](../design.md) §1과 §7에 있다. 레포 구성과 작업 방식은 [`hackathon.md`](../hackathon.md)와 [`AGENTS.md`](../../AGENTS.md) §5, 기술 선택과 폴더 구조는 [ADR-001](001-stack.md)에서 다룬다.

## 대안

| 대안 | 장점 | 버린 이유 |
| --- | --- | --- |
| 모든 프로젝트를 클라우드 VM에서 실행 | 구조가 단순하고 PC 켜짐 여부를 신경 쓰지 않아도 된다 | 학교 유휴 PC를 쓰는 것이 서비스의 핵심이다. 프로젝트 수만큼 VM 자원과 비용이 늘어난다 |
| 학교 PC에 공인 주소·포트포워딩으로 직접 접속 | VPN 없이 연결된다 | 학교 방화벽 안이라 밖에서 바로 접속할 수 없다 |
| PC마다 도커만 설치하고 직접 배치 | 쿠버네티스를 배우고 운영할 필요가 없다 | 자리가 남은 PC 고르기, 켜짐 감지, PC가 꺼졌을 때 재배치를 직접 만들어야 한다 |
| 모든 프로젝트를 학교 PC에서 실행 | 실행 경로가 하나다 | 서버가 필요 없는 프로젝트까지 PC 켜짐에 묶인다. 정적 파일은 R2에서 바로 보여주면 된다 |
| 학교 PC가 없으면 미리보기만 (초안) | VM 자원을 학생 프로젝트에 쓰지 않는다 | 심사 기간에 학교 PC가 꺼져 있으면 시연이 안 된다. VM을 예비 노드로 두면 같은 배치 규칙으로 해결된다 |
| 빌드 작업기를 VM 프로세스로 두고 `docker build` (초안) | 가장 단순하다 | 학생 Dockerfile의 `RUN`이 메인 VM에서 root Docker 데몬으로 실행된다. k3s Job + rootless BuildKit이면 자원 제한과 네트워크 제한을 Pod 규칙으로 같이 건다 |
| Nginx를 VM에 직접 설치해 요청 분배 (초안) | 익숙하다 | 학생 앱이 생길 때마다 upstream 설정을 손으로 갱신해야 한다. Traefik은 k3s에 내장돼 Ingress 리소스만 만들면 라우팅과 TLS가 따라온다 |
| api를 VM에서 docker compose로 따로 운영 | k8s 없이 익숙한 방식으로 돌린다 | Traefik 뒤에 들어가지 못해 TLS와 도메인을 따로 관리해야 하고, 클러스터를 조작할 kubeconfig를 밖에서 관리해야 한다. 클러스터 안에서 ServiceAccount로 권한을 주는 쪽이 설정이 적다 |

## 결과

- **쉬워지는 것**: 서버가 필요 없는 프로젝트는 학교 PC 상태와 상관없이 항상 보인다. 학교 PC가 전부 꺼져도 VM에서 시연이 된다. 배치, 재배치, 라우팅, TLS를 전부 k3s 리소스(Deployment + Ingress)로 다루므로 api 코드가 단순하다. PC를 추가해도 설정이 거의 늘지 않는다.
- **어려워지는 것**: 팀이 k3s 리소스(Job, Deployment, Ingress, NetworkPolicy, affinity/taint)를 다뤄야 한다. 격리 값, PC 사용자 몫, 예비 노드 상한은 측정 뒤에 정해야 한다. 미정 항목은 [`design.md`](../design.md) §7.
- **다시 볼 조건**: 학교가 실습실 PC 사용을 허가하지 않거나 시연 환경에서 학교 PC를 쓸 수 없으면, 같은 클러스터에서 VM 노드만으로 운영한다. 구조는 그대로고 노드만 줄어든다.
