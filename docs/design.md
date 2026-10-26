# 설계 — 아키텍처와 FE/BE/AI 계약

> **기술 설계·이해도 10점** 근거 문서. 무엇을 만드는지는 [`SRS.md`](SRS.md), 왜 이 기술인지는 [`adr/`](adr/README.md).
> FE·BE·AI가 병렬로 일하는 기준이 §3 계약이다. **API를 바꾸기 전에 이 문서를 먼저 고치고**, 같은 PR에 코드 변경을 싣는다.

## 1. 아키텍처

> 왜 이 구조인지와 버린 대안은 [`adr/002-system-architecture.md`](adr/002-system-architecture.md). 아직 팀 합의 전인 **제안**이다. 구조가 바뀌면 새 ADR을 쓰고 이 절을 고친다.

![시스템 아키텍처 구성도](system-architecture.drawio.svg)

원본은 `system-architecture.drawio.svg` 하나다. draw.io로 열어 고치고, 비압축 XML이라 텍스트로도 읽힌다. 기술 이름은 [`adr/001-stack.md`](adr/001-stack.md)에서 정하며 확정 전이다.

### 1.1 한 줄로

학생이 프로젝트를 올리면 LLM이 실행 방식을 분류하고, 정적인 것은 R2에서, 서버가 필요한 것은 학교 실습실 PC(k3s)에서 돌린다. 학교 PC가 없으면 클라우드 VM이 대신 돈다.

### 1.2 흐름

1. 학생이 web에 프로젝트를 올린다.
2. api가 LLM API로 실행 방식을 분류하고 위험 코드를 표시한다.
3. 분류별로 처리한다. 빌드가 필요할 때만 api가 k3s에 빌드 Job(rootless BuildKit)을 만든다.

| 실행 방식 | 처리 | 실행 위치 |
| --- | --- | --- |
| 정적 | api가 파일을 그대로 R2에 올린다 (빌드 없음) | R2 |
| 브라우저 실행 | 빌드 Job이 빌드 결과를 R2에 올린다 | R2 |
| 서버 필요 | 빌드 Job이 이미지를 GHCR에 올리고 k3s가 Deployment·Ingress로 띄운다 | 학교 PC, 없으면 VM |

4. 빌드·실행 상태는 api가 k3s에서 로그와 상태를 읽어 web에 보여준다 (전송 방식은 §3).
5. 요청은 VM의 Traefik이 받아 Tailscale 위로 Pod에 보낸다. 학교 PC가 꺼지면 k3s가 다른 학교 PC로 옮기고, 전부 없으면 api가 VM으로 돌린다 (복구 시간은 §7 11번).
6. Pod가 없는 프로젝트의 요청은 api 안내 페이지로 간다. 깨울 수 있으면 깨우고(§7 5번), 아니면 R2 미리보기로 보낸다.

### 1.3 구성 요소

| 어디 | 무엇 | 역할 |
| --- | --- | --- |
| 개발 | GitHub · GitHub Actions | 모노레포([ADR-001](adr/001-stack.md)). Actions가 web은 Vercel CLI로, api 이미지는 GHCR로, 클러스터는 Tailscale 위 `kubectl`로 배포. 업타임 cron도 여기 |
| | GHCR | api·학생 프로젝트 이미지. private, 한도에 닿으면 public (§1.5) |
| Vercel | web (React) | 우리 서비스 웹사이트. 학생 코드는 안 들어간다 |
| 클라우드 VM (항상 켜짐) | k3s 서버 | 클러스터 관리, 배치, 노드 상태. 학교 PC가 조인하는 대상 |
| | Traefik (k3s 내장) | Ingress·TLS. api와 학생 앱 라우팅. Pod 없는 프로젝트는 api 안내 페이지로 |
| | api (FastAPI) | 업로드, 분석 요청, k3s 리소스 생성·수정, 상태·로그 조회, 정적 프로젝트 R2 업로드. RBAC은 학생 네임스페이스의 `jobs`·`deployments`·`ingresses`·`pods/log`와 `nodes` 읽기 |
| | 빌드 Job (rootless BuildKit) | 학생 코드 → 이미지(GHCR) 또는 정적 결과물(R2). 나가는 연결은 허용 목록 egress 프록시만 (구성도에 없음) |
| | 학생 Pod (예비) | 학교 PC가 하나도 없을 때만 |
| 외부 | Supabase | PostgreSQL(사용자·프로젝트·실행 기록), Auth |
| | LLM API | 분류, 위험 코드 표시 |
| | Cloudflare R2 | 학생 정적 결과물·미리보기. S3 호환, egress 무료, 학생 결과물 도메인으로 공개 |
| | Docker Hub · 패키지 저장소 | 빌드가 받는 베이스 이미지·의존성 |
| Tailscale | — | VM과 학교 PC를 잇는 사설망. 학교 PC는 방화벽 안이라 이 길뿐 (MTU는 §7 17번) |
| 학교 실습실 PC (켜져 있을 때만) | k3s 에이전트 · 학생 Pod ×N | 서버 필요 프로젝트 실행. 이미지는 학교망에서 직접 받는다. 한 PC에 여러 Pod |

### 1.4 구성도 색

| 색 | 흐름 |
| --- | --- |
| 검정 | 사용자 요청. 브라우저 → web / Traefik → api·학생 Pod / R2 |
| 파랑 | 배포. GitHub → Actions → Vercel·GHCR·k3s |
| 주황 | AI. api ↔ LLM API |
| 초록 | 실행. api → k3s → 빌드 Job → GHCR·패키지 저장소 / k3s → 학교 PC, VM 예비 / 학교 PC·VM → GHCR (이미지 받음) |
| 보라 | 데이터. api ↔ Supabase / api·빌드 Job → R2 |
| 회색 점선 | 학교 PC → k3s (조인, Ready) |

학교 PC 선은 실습실 테두리에 묶었다. Traefik → 학생 Pod 선은 VM 예비 Pod도 뜻한다. 회색 점선 상자는 아이콘이 없어 자리만 잡은 것이다. 빌드 egress 프록시는 그리지 않았고, 빌드 Job에서 나가는 선은 전부 프록시를 거친다.

### 1.5 운영 규칙 ([ADR-002](adr/002-system-architecture.md) 세부)

**배치**

- VM = k3s 서버 + 예비 워커. 학교 PC = 에이전트 노드.
- api·Traefik·빌드 Job은 `nodeSelector`로 VM 고정.
- 학생 Pod는 `required nodeAffinity`로 학교 PC만. VM은 `NoSchedule` taint. Ready인 학교 PC가 없을 때만 api가 affinity를 VM 조건으로 바꾸고 toleration을 붙인다(둘을 같이 두면 어디에도 안 간다). 학교 PC가 돌아오면 api 주기 작업이 되돌린다. `preferred`는 학교 PC가 있어도 VM에 갈 수 있어 안 쓴다.
- NotReady면 `tolerationSeconds` 30초로 eviction 시작(기본 5분). 끝에서 끝까지 복구 시간은 재서 §7 11번에.
- 켜짐 여부는 노드 Ready 그대로. api는 읽기만, 핑 없음.
- 한 PC에 여러 Pod. 16GB PC에서 `system-reserved` 6GB·`kube-reserved` 0.5GB·eviction 0.5GB를 빼면 allocatable ≈ 9GB. 학생 Pod 256Mi(requests = limits, Guaranteed)면 약 36개, `max-pods` 40. 512Mi 등급은 자리 두 개. 값은 §7 3·4번에서 조정.

**GHCR**

- private. 노드는 `registries.yaml`의 읽기 토큰(`read:packages`, 참여 스크립트가 만들고 교체도 같은 스크립트). 쓰기는 빌드 네임스페이스의 `write:packages` Secret, 빌드 Job만 마운트.
- 교체는 새 Secret + GitHub에서 이전 토큰 폐기(Secret만 바꾸면 이전 토큰이 살아 있다). 접을 때 둘 다 삭제. 값은 레포에 안 넣는다.
- 무료 한도(저장·전송, Actions 밖 pull 포함)에 닿으면 학생 이미지를 public으로. 코드가 공개되니 업로드 화면에서 미리 알린다. 숫자는 §7 13번.

**실행 격리**

- 학생 네임스페이스에 PSA `restricted`: non-root, 호스트 네임스페이스·경로 금지, 권한 상승 금지, capabilities 전부 drop, seccomp `RuntimeDefault`.
- `automountServiceAccountToken: false`, 권한 없는 ServiceAccount, Pod 간 통신 차단 NetworkPolicy.
- egress는 클러스터 DNS(53)와 인터넷만. 클러스터 대역·Tailscale 대역·169.254.169.254는 `ipBlock`/`except`로 차단. Pod → 자기 노드는 NetworkPolicy가 못 막으니 노드 nftables로 막고 측정(§7 6번).
- 커널은 공유라 완전 격리는 아니다. gVisor는 이후.

**빌드 격리**

- 학생 Dockerfile `RUN`은 임의 코드 실행이다. 그래서 호스트 Docker가 아니라 k3s Job 안 rootless BuildKit.
- Job에도 같은 격리 기준과 requests/limits. egress는 허용 목록 HTTP 프록시(GHCR, Docker Hub, 패키지 저장소, R2)만, `HTTP_PROXY`/`HTTPS_PROXY`로. NetworkPolicy는 프록시·DNS 외 전부 차단.
- Job에 들어가는 비밀은 GHCR 쓰기 토큰과 R2 쓰기 키. `RUN` 안에서 안 보이는지 `RUN env; ls /run/secrets`로 확인(§7 6번).
- 빌드가 VM IP 하나로 나가 Docker Hub 비로그인 pull 제한에 걸린다. 로그인 `config.json`을 Secret으로, 모자라면 pull-through 캐시(`registry:2` mirror).

**네트워크 경계**

- VM: 80/443만 공개. SSH·6443·10250·8472/UDP는 Tailscale 인터페이스만.
- 학교 PC: 같은 포트를 Tailscale 인터페이스만. k3s는 `--node-ip`를 Tailscale 주소, `--flannel-iface`를 `tailscale0`으로.
- 참여 스크립트 순서: Tailscale 로그인 → `registries.yaml` → k3s 에이전트 조인(파일을 시작할 때 읽는다).
- 둘 다 `infra/` 스크립트가 만든다.

## 2. 컴포넌트 책임

| 컴포넌트 | 책임 | 하지 않는 것 | 담당 |
| --- | --- | --- | --- |
| FE | | | |
| BE | | | |
| AI | | | |

"하지 않는 것"을 적어 두면 두 곳이 같은 일을 하거나 아무도 안 하는 일이 줄어든다.

## 3. API 계약

FE가 BE를, BE가 AI를 기다리지 않도록 **요청·응답 모양을 먼저 고정**한다. 구현 전에는 이 예시 응답을 그대로 돌려주는 목 서버로 개발한다 — 그 목은 `MOCK(<id>)` 마커와 [`ai-scope.md`](ai-scope.md) 등록 대상이다.

### `METHOD /path` — 한 줄 설명 (FR-xx)

요청:

```json
{}
```

응답 `200`:

```json
{}
```

오류: `400` 입력 오류 / `502` AI 호출 실패 — 오류 응답 모양은 §4.

<!-- 엔드포인트마다 위 블록을 복사 -->

## 4. 공통 규칙

- 오류 응답: `{ "error": { "code": "STRING", "message": "사람이 읽는 설명" } }`
- 시간: ISO 8601, UTC
- CORS: api는 web의 프로덕션 도메인만 허용한다. 학생 결과물 도메인은 api를 부르지 않는다
- AI 호출 실패 시 사용자에게 보이는 동작: TBD (재시도 버튼? 사람에게 넘기기?) — 시연 중 실패에 대한 답이므로 반드시 정한다.

## 5. 데이터 모델

| 엔티티 | 필드 | 설명 |
| --- | --- | --- |
| | | |

## 6. 배포

| 컴포넌트 | 배포처 | URL | 환경 변수 |
| --- | --- | --- | --- |
| FE | | | |
| BE | | | |

비밀값은 배포처 환경 변수에만 둔다. 여기에는 **변수 이름만** 적는다. [ADR-001](adr/001-stack.md) 채택 뒤에 채운다. 제안 단계의 목록은 §7 19번.

## 7. 정해야 할 것

아키텍처([ADR-002](adr/002-system-architecture.md))에서 아직 정하지 않은 항목. 정해지면 되돌리기 비싼 것은 ADR로, 나머지는 이 문서의 해당 절에 반영하고 여기서 지운다.

| # | 항목 | 고민할 점 | 제안 |
| --- | --- | --- | --- |
| 1 | "정적 미리보기"의 정의 | 서버 필요 프로젝트의 미리보기가 화면 스크린샷인지, 백엔드 없이 프론트만 띄운 것인지. 스크린샷이면 누가 언제 찍는지 | 정해지면 구성도에 반영 |
| 2 | 학생 결과물 도메인 구성 | 서비스(`app.example.com`)와 학생 결과물(`example-usercontent.com`)은 분리한다. 정적(R2 커스텀 도메인)과 서버 필요(`<프로젝트>.` 와일드카드 → Traefik)를 한 도메인 아래 어떻게 나눌지, 도메인 구매와 DNS를 누가 맡을지. R2 커스텀 도메인 하나에 프로젝트를 경로로 나누면(`static.도메인/<프로젝트>/`) 전부 같은 origin이라 브라우저 실행 프로젝트의 JS가 옆 프로젝트의 localStorage·쿠키를 읽는다 | Cloudflare DNS 하나로 관리. 프로젝트마다 `<프로젝트>.도메인` 서브도메인을 주고, 정적도 `*.`를 받는 쪽(Traefik 또는 Cloudflare Worker)이 R2의 `<프로젝트>/` 경로로 바꿔 준다. `static.` 하나로 경로 분리는 쓰지 않는다. 인증서는 15번 |
| 3 | PC 사용자 몫 예약 값 | 수업 중에는 사람이 PC를 쓴다. 학생 프로젝트가 PC를 느리게 만들면 학교가 참여를 막을 수 있다 | `system-reserved` CPU 2코어·메모리 6GB, `kube-reserved` 0.5GB, `eviction-hard` memory.available<500Mi부터 시작해 측정 후 조정 |
| 4 | Pod 자원 기본값 | requests/limits가 없으면 무한루프 하나가 같은 PC의 다른 프로젝트까지 죽인다. 메모리는 limits가 requests보다 크면 스케줄러가 센 수보다 실제 사용이 커져 노드가 터질 수 있다 | 메모리 requests = limits = 256Mi(Guaranteed), CPU requests 100m · limits 500m(CPU는 넘쳐도 느려질 뿐이라 오버커밋 허용). 노드당 `max-pods` 40. 측정 후 조정 |
| 5 | 안 쓰는 프로젝트 내리기 | 아무도 보지 않는 프로젝트를 계속 켜 두면 자원 낭비다. replicas가 0이면 그 주소로 온 요청을 받을 Pod가 없으므로 깨우는 경로가 따로 있어야 한다. "마지막 접속"을 누가 기록하는지도 정해야 한다. 요청은 Traefik에서 Pod로 바로 가서 api는 모른다 | Traefik의 학생 앱 라우트에 `forwardAuth` 미들웨어를 걸어 api가 요청마다 프로젝트별 마지막 접속 시각을 갱신한다(응답은 항상 통과). 마지막 접속 후 30분이 지나면 api가 학생 Deployment의 replicas를 0으로 내리고 그 Ingress를 api의 깨우기 페이지로 돌린다. 접속이 오면 그 페이지가 replicas를 1로 올리고, 준비되면 Ingress를 원래대로 되돌린다 (몇 초에서 수십 초) |
| 6 | 격리 수준 | 한 PC에 서로 다른 학생의 코드가 같이 돈다. §1.5의 실행 격리 기준(PSA `restricted`, ServiceAccount 토큰 비마운트, NetworkPolicy)을 걸어도 커널은 공유한다 | 그 기준을 최소선으로 매니페스트에 박는다. NetworkPolicy와 호스트 방화벽이 메타데이터 주소·Tailscale 대역·자기 노드를 실제로 막는지 학생 Pod 안에서 `curl`로 확인한다. 빌드 Job의 Secret(GHCR·R2 키)이 Dockerfile `RUN` 안에서 안 보이는지 `RUN env; ls /run/secrets`로 확인한다. gVisor 같은 샌드박스 런타임을 넣을지, 넣는다면 언제인지 정한다 |
| 7 | 위험 코드 처리 | LLM이 위험 코드를 표시한 뒤 실행을 막는지, 경고만 하는지 | 팀 논의 |
| 8 | AI 역할 범위 | 분류와 위험 표시만 할지, 실행 계획(Dockerfile·빌드 명령·포트·환경변수)까지 제안하고 학생이 승인하게 할지. 주제 "AI는 동료가 될 수 있을까?"의 답이 이 흐름에 들어간다. LLM에 보내는 범위(파일 수·토큰 상한, `node_modules`·바이너리 제외)와 프로젝트당 비용 상한도 없고, 학생 코드가 외부 LLM API로 나간다는 고지도 없다 | 실행 계획까지. [`SRS.md`](SRS.md) "AI 동료의 역할 경계"와 함께 정한다. 분석 입력은 파일 목록 + 설정 파일(`package.json`, `requirements.txt`, `Dockerfile` 등) + 진입점 몇 개로 제한하고 토큰 상한을 둔다. 업로드 화면에 "코드가 분석을 위해 외부 LLM API로 전송된다"를 표시하고 [`ai-scope.md`](ai-scope.md) §5에 적는다 |
| 9 | VM 예비 노드 용량 | VM 크기와, 학교 PC가 없을 때 VM에 동시에 띄울 학생 Pod 수 상한 | 네임스페이스 ResourceQuota로 상한. 값은 VM 업체·크기 정한 뒤 |
| 10 | 심사 기간 운영 | 2026-11-15 제출 마감부터 11.16–20 사전 심사, 11.21 본선까지([`hackathon.md`](hackathon.md) §일정) 학교 PC가 꺼져 있다고 가정하고 VM만으로 시연이 되어야 한다. Supabase 무료 플랜은 지난 7일간 DB 활동이 충분하지 않으면 프로젝트를 일시 정지한다. 공식 문서는 "하루에 몇 번의 요청이면 보통 충분"이라고 하고, 정지 일주일 전에 경고 메일이 온다 ([문서](https://supabase.com/docs/guides/platform/free-project-pausing), 2026-10-26 확인) | 시연용 프로젝트는 VM에 미리 띄워 둔다. api가 한 시간에 한 번 DB에 가벼운 쿼리를 보내는 작업을 돌리고, 경고 메일이 오면 대시보드에서 바로 확인한다. 불안하면 심사 주간만 Pro 플랜으로 올린다 |
| 11 | 노드 장애 복구 시간 | NotReady 감지 → eviction → 재스케줄 → 이미지 pull → readiness. `tolerationSeconds` 30초는 그중 한 구간이다. VM으로 넘어갈 때는 VM에 이미지가 없어 pull 시간이 통째로 더해진다 | 시연 전에 PC를 실제로 꺼서 끝에서 끝까지 시간을 재고 목표를 정한다. 학교 PC → VM 전환도 따로 잰다 |
| 12 | 학교에 확인할 것 | ADR-002의 학교 PC 전제는 확인한 사실이 아니라 가정이다. 하나라도 틀리면 참여 스크립트나 ADR이 바뀐다 | 전산실에 한 번에 묻는다: ① 실습실 PC에서 나가는 443이 되는지, UDP(41641)도 되는지 ② VPN·P2P 트래픽을 따로 막는지 ③ 인터넷 전에 웹 로그인(인증 포털)을 거치는지 ④ 재부팅하면 복원되는 PC인지 ⑤ 관리자 권한으로 스크립트를 돌릴 수 있는지 ⑥ 배포판·커널 버전 ⑦ 수업 시간표(켜져 있는 시간) |
| 13 | GHCR 한도 | private 패키지는 저장·전송 한도가 있고 노드의 pull이 전송량에 든다(§1.5 GHCR). 학생 이미지 하나 수백 MB면 금방 닿는다 | 요금 페이지에서 현재 값을 확인해 여기 적는다. 닿으면 학생 이미지를 public으로 돌린다. 대안으로 VM에 R2를 백엔드로 쓰는 레지스트리(`registry:2`)를 두면 한도가 없지만 운영할 게 하나 는다 |
| 14 | 학생 코드 입력 경로와 원본 보관 | zip 업로드인지 GitHub URL인지, 원본을 어디 두는지가 비어 있다. URL이면 빌드 Job → GitHub(학생 레포) 선이 생기고 egress 프록시 허용 목록에 `github.com`이 들어간다. 원본 보관 위치는 되돌리기 비싼 데이터 저장소 결정이라 ADR 감이다 | 둘 다 받되 1차는 GitHub URL(학생이 이미 레포를 갖고 있고 업로드 용량 문제가 없다). 원본은 R2의 비공개 버킷에 두고 api가 쓰고 빌드 Job이 읽는다. 정해지면 구성도의 api → R2, 빌드 Job → R2 선에 반영 |
| 15 | 와일드카드 TLS | `*.학생결과물` 인증서는 HTTP 챌린지로 못 받는다. DNS-01(Traefik에 Cloudflare API 토큰)이거나, Cloudflare 프록시를 앞에 두고 origin 인증서를 Traefik에 고정하는 방식이다. 후자면 브라우저 → Cloudflare → Traefik으로 구성도가 바뀌고 VM IP가 가려진다 | Cloudflare 프록시 + Origin CA 인증서. ACME 갱신이 없고 VM IP가 안 드러난다. WebSocket은 통과하지만 요청당 100초 제한이 있으니 학생 앱의 긴 요청은 그 안에 끝나야 한다. 정해지면 구성도와 §6 Traefik 행 수정 |
| 16 | 빌드 동시 실행과 시간 제한 | `npm install` 하나가 1~2GB를 쓴다. 상한이 없으면 업로드 몇 개가 겹칠 때 VM이 먼저 죽는다. 9번은 예비 Pod만 다룬다 | Job에 `activeDeadlineSeconds` 600, 메모리 requests = limits = 2Gi, 빌드 네임스페이스 ResourceQuota로 동시 2개. 넘치면 api가 큐에 쌓고 순서를 web에 보여준다. VM 크기 정한 뒤 숫자 조정 |
| 17 | flannel over Tailscale MTU | `tailscale0`(MTU 1280) 위에 vxlan을 얹으면 큰 응답이 조각나서 끊길 수 있다 | k3s 내장 `--vpn-auth`(Tailscale) 연동을 먼저 시험한다. 그게 MTU를 맞춰 준다. 안 되면 flannel MTU를 1230 아래로 수동 지정. 샘플 앱에서 1MB 응답으로 확인 |
| 18 | 학생 프로젝트의 범위 | Pod에 볼륨이 없어 PC가 꺼지면 SQLite·업로드 파일이 사라진다. DB가 따로 필요한 프로젝트(예: Django + Postgres)는 Pod 하나로 못 돌린다. Traefik은 HTTP/WebSocket만 받고 raw TCP는 안 된다 | "서버 필요"는 HTTP/WS를 듣는 단일 컨테이너, 상태는 재시작 때 사라진다고 정의한다. LLM 분류가 그 밖(별도 DB, TCP 포트)을 감지하면 "지원 범위 밖"으로 표시하고 미리보기만 만든다. [`SRS.md`](SRS.md) 범위 밖에 적는다 |
| 19 | 비밀값과 환경 변수 목록 | 지금 설계만으로 비밀값이 아홉 종류다. 이름을 미리 정해 두지 않으면 세팅하는 날 하나씩 찾는다. ADR-001이 채택되면 §6 표로 옮기고 [`.env.example`](../.env.example)과 이름을 맞춘다. web에 `VITE_SUPABASE_ANON_KEY`가 있는 건 브라우저가 Supabase Auth를 직접 부른다는 뜻인데, 구성도와 §1.4에는 그 선이 없다. 로그인이 브라우저 직접인지 api 경유인지 정하면 둘 다 반영한다 | web(Vercel): `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` / api(k3s Secret): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LLM_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `STUDENT_DOMAIN`(k3s 접근은 ServiceAccount 토큰) / 빌드 Job(빌드 네임스페이스 Secret): `GHCR_WRITE_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `DOCKERHUB_CONFIG_JSON`, `HTTP_PROXY`/`HTTPS_PROXY`(비밀 아님) / Traefik: 15번에 따라 `CF_DNS_API_TOKEN` 또는 없음 / 노드(VM·학교 PC, `infra/` 스크립트가 파일로 생성): `registries.yaml`의 GHCR 읽기 토큰, Tailscale 인증 키(태그 붙은 재사용 키), k3s 노드 토큰 / GitHub Actions(레포 Secrets): `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `TAILSCALE_OAUTH_CLIENT_ID`/`SECRET`(러너용 임시 키), `KUBECONFIG`(배포 전용 ServiceAccount), `GITHUB_TOKEN`(GHCR push, 기본 제공) |
