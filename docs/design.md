# 설계 — 아키텍처와 FE/BE/AI 계약

> **기술 설계·이해도 10점** 근거 문서. 무엇을 만드는지는 [`SRS.md`](SRS.md), 왜 이 기술인지는 [`adr/`](adr/README.md).
> FE·BE·AI가 병렬로 일하는 기준이 §3 계약이다. **API를 바꾸기 전에 이 문서를 먼저 고치고**, 같은 PR에 코드 변경을 싣는다.

## 1. 아키텍처

> 왜 이 구조인지와 버린 대안은 [`adr/002-system-architecture.md`](adr/002-system-architecture.md)에 있다. 아래는 그 결정의 현재 모습이다. 구조가 바뀌면 새 ADR을 쓰고 이 절을 고친다. 아직 팀 합의 전인 **제안** 상태다.

![시스템 아키텍처 구성도](system-architecture.drawio.svg)

구성도 원본은 `system-architecture.drawio.svg` 하나다. draw.io(데스크톱 또는 VS Code 확장)로 열면 바로 수정할 수 있고, 압축하지 않은 XML이 들어 있어 텍스트로도 읽을 수 있다. 기술 이름은 [`adr/001-stack.md`](adr/001-stack.md)에서 정하며 아직 확정 전이다. 구성도에서 아이콘과 이름 라벨을 따로 두었으므로 바뀌면 해당 상자만 고치면 된다.

### 1.1 서비스 흐름

1. 학생이 웹사이트(web)에 프로젝트를 올린다.
2. api가 LLM API로 코드를 분석해 실행 방식을 분류하고, 위험한 코드를 표시한다.
3. 분류 결과에 따라 다르게 처리한다. 빌드가 필요한 경우에만 api가 k3s에 빌드 Job을 만들고, Job은 rootless BuildKit으로 결과물을 만든다.

| 실행 방식 | 처리 | 실행 위치 |
| --- | --- | --- |
| 정적 | 빌드 없이 api가 파일을 그대로 R2에 올려 학생 결과물 도메인으로 바로 공개한다 | R2 |
| 브라우저 실행 | 빌드 Job이 빌드한 결과를 R2에 올려 공개한다 | R2 |
| 서버 필요 | 빌드 Job이 이미지를 만들어 GHCR에 올리고, k3s 서버가 Deployment·Ingress로 배치한다 | 학교 PC 우선, 없으면 클라우드 VM |

4. 빌드와 실행 상태는 api가 k3s에서 Job·Pod 로그와 상태를 읽어 web에 흘려준다(전송 방식은 §3 계약에서 정한다). 학생은 web에서 "빌드 중 → 배포됨 → 실패"를 본다.
5. 사용자 요청은 VM의 Traefik이 받아 Tailscale 위로 해당 Pod에 전달한다. 학교 PC가 꺼지면 k3s가 감지해 다른 학교 PC로 재배치하고, 학교 PC가 하나도 없으면 api가 VM으로 돌린다(§1.5 배치, 복구 시간은 §7 11번).
6. Pod가 없을 때(학교 PC도 VM 자리도 없거나, §7 5번으로 내려가 있을 때) 그 프로젝트의 Ingress는 api의 안내 페이지로 간다. 안내 페이지가 깨우기를 시도하고, 깨울 수 없으면 R2에 저장해 둔 정적 미리보기로 보낸다. Traefik → api 선이 이 경로다.

### 1.2 영역과 구성 요소

| 영역 | 구성 요소 | 역할 |
| --- | --- | --- |
| 개발 영역 | 개발자 (팀원 3명) | 코드 작성, PR |
| | GitHub | 모노레포 `WOOWANGTHON_TEAM_18` (폴더 구조는 [ADR-001](adr/001-stack.md)) |
| | GitHub Actions | 테스트, 빌드. web은 Vercel CLI로 Vercel에, api 이미지는 GHCR로, 클러스터 배포는 Tailscale 위 `kubectl`로(러너가 임시 인증 키로 Tailscale에 붙는다). 배포 URL 업타임 cron도 여기서 돈다([ADR-001](adr/001-stack.md) §결과) |
| | GHCR | api 이미지와 학생 프로젝트 이미지 (private, 한도에 닿으면 public — §1.5 배치). 노드마다 k3s `registries.yaml`의 읽기 전용 토큰으로 받는다. VM 노드는 api 이미지와 예비 Pod 이미지를 클라우드 쪽 인터넷으로 받는다 |
| Vercel | web (React) | 우리 서비스 웹사이트 |
| 클라우드 VM – Main (항상 켜짐) · k3s 서버 노드 + 예비 워커 | k3s 서버 | 클러스터 관리, Pod 배치, 노드 상태. 학교 PC가 참여 스크립트로 조인하는 대상 |
| | Traefik (k3s 내장) | Ingress, TLS, 요청 분배 (api, 학생 앱). Pod가 없는 프로젝트의 요청은 api의 안내 페이지로 보낸다(§1.1 6번) |
| | api (FastAPI) Pod | 업로드 처리, 분석 요청, 빌드 Job·Deployment·Ingress 생성·수정, 노드 상태·로그 조회(RBAC: 학생 네임스페이스의 `jobs`·`deployments`·`ingresses`·`pods/log`, 클러스터의 `nodes` 읽기). 정적 프로젝트는 직접 R2에 올린다. VM 노드에 고정 |
| | 빌드 Job (rootless BuildKit) | 학생 코드 → 이미지(GHCR) 또는 정적 결과물(R2). VM 노드에 고정 |
| | 빌드 egress 프록시 | 빌드 Job의 나가는 연결을 전부 받는 허용 목록 HTTP 프록시(GHCR, Docker Hub, 패키지 저장소, R2). Job에는 `HTTP_PROXY`/`HTTPS_PROXY`로 넣는다. VM 노드에 고정, 구성도에는 그리지 않았다 |
| | 학생 프로젝트 Pod (예비) | 학교 PC가 하나도 없을 때만. api가 toleration을 붙여 배치하고, PC가 돌아오면 되돌린다 |
| 외부 서비스 | Supabase | PostgreSQL(사용자, 프로젝트, 실행 기록), Auth(로그인) |
| | LLM API | 코드 분석, 실행 방식 분류, 위험 코드 표시 |
| | Cloudflare R2 | 정적 결과물, 미리보기. 학생 결과물 도메인으로 공개 |
| | Docker Hub · 패키지 저장소 | 빌드 Job이 받는 베이스 이미지와 의존성(npm, PyPI 등). egress 프록시를 통해서만 나간다 |
| Tailscale 사설망 | — | VM과 학교 PC를 잇는 통로. 학교 PC는 방화벽 안이라 밖에서 들어오는 다른 길이 없고, k3s는 `--node-ip`를 Tailscale 주소로, `--flannel-iface`를 `tailscale0`으로 줘서 노드 간 통신을 이 위로 보낸다(MTU 문제는 §7 17번). 설정은 `infra/`에 둔다 |
| 학교 실습실 PC · k3s 에이전트 노드 (켜져 있을 때만 참여) | k3s 에이전트 | 참여 스크립트가 Tailscale 로그인 → `registries.yaml` 생성 → k3s 에이전트 조인 순서로 붙인다(k3s는 `registries.yaml`을 시작할 때 읽는다). 지시받은 Pod 실행, 노드 상태 보고 |
| | 학생 프로젝트 Pod ×N | 서버 필요 프로젝트. GHCR 이미지는 학교망에서 직접 받는다 |

#### Vercel과 R2의 차이

둘 다 정적 파일을 내보내지만 대상이 다르다.

- **Vercel**: 우리 팀이 만든 서비스 웹사이트(React)만 올린다. 프론트엔드 코드가 main에 머지되면 빌드해서 Vercel CDN에 배포한다. 학생 코드는 들어가지 않는다.
- **R2**: 학생 프로젝트 결과물을 넣는 파일 저장소다. 정적·브라우저 실행 프로젝트의 빌드 결과와, 서버 필요 프로젝트의 미리보기를 둔다. S3 호환 API라 `boto3`로 올릴 수 있고, 외부 전송(egress) 요금이 없다. 학생 결과물 도메인을 R2 커스텀 도메인으로 연결해 공개한다.

#### 학교 PC 한 대에 여러 프로젝트

구성도는 PC마다 학생 프로젝트 Pod를 하나씩 그렸지만, 실제로는 PC 한 대에 여러 개가 돈다. 학생 프로젝트 하나가 Pod 하나이고, k3s 서버가 각 PC의 남은 자원(requests 합)을 보고 자리가 있는 PC에 배치한다. 수용량은 requests로 센다. 16GB PC에서 `system-reserved` 6GB(수업 중 사용자 몫), `kube-reserved` 0.5GB, eviction 여유 0.5GB를 빼면 allocatable은 약 9GB다. 학생 Pod의 메모리를 requests = limits = 256Mi로 두면(Guaranteed QoS, 오버커밋 없음) 한 대에 약 36개가 들어가고, 전부 limit까지 써도 합이 allocatable을 넘지 않는다. 여기에 `max-pods` 40으로 노드당 개수 상한을 건다. 512Mi 등급을 고른 프로젝트는 자리를 두 개 쓴다. 실제 값은 샘플 앱을 띄워 재고 §7 4번에서 조정한다.

### 1.3 흐름 (구성도 색 기준)

| 색 | 흐름 | 경로 |
| --- | --- | --- |
| 검정 | 사용자 요청 | 브라우저 → web(Vercel) / 브라우저 → Traefik → api (서비스 API, Pod 없는 프로젝트의 깨우기·미리보기 안내) / 브라우저 → Traefik → (Tailscale) → 학생 Pod (학교 PC 또는 VM 예비) / 브라우저 → R2 (정적 프로젝트, 미리보기) |
| 파랑 | 코드 배포 (CI/CD) | 개발자 → GitHub → GitHub Actions → web(Vercel CLI), GHCR(api 이미지), k3s 서버(배포, Tailscale 위 `kubectl`) |
| 주황 | AI 분석 | api ↔ LLM API |
| 초록 | 학생 프로젝트 실행 | api → k3s 서버(Job·Deployment·Ingress 생성·수정, 노드 상태·로그 조회) / k3s 서버 → 빌드 Job → (egress 프록시) → GHCR(이미지 올림) / 빌드 Job → (egress 프록시) → Docker Hub·패키지 저장소(베이스 이미지·의존성 받음) / k3s 서버 → (Tailscale) → 학교 PC(우선 배치) / k3s 서버 → VM 예비 Pod(학교 PC 없을 때) / 학교 PC → GHCR(이미지 받음, 학교망 직접) / VM → GHCR(api·예비 Pod 이미지 받음) |
| 보라 | 데이터 | api ↔ Supabase / api → R2(정적 프로젝트, 빌드 없음) / 빌드 Job → (egress 프록시) → R2 |
| 회색 점선 | 상태 확인 | 학교 PC → k3s 서버 (참여 조인, 노드 Ready) |

### 1.4 구성도 참고

- 학교 PC 쪽 화살표는 PC마다 긋지 않고 실습실 영역 테두리에 연결했다.
- Traefik → 학생 Pod 화살표는 학교 PC와 VM 예비 Pod 둘 다를 뜻한다. 구성도에는 실습실 쪽 하나만 그렸다.
- draw.io 내장 라이브러리에 아이콘이 없어 회색 점선 상자로 자리만 잡아 둔 구성 요소: GitHub Actions, GHCR, React, Traefik, Cloudflare R2, LLM API, Docker Hub · 패키지 저장소.
- 빌드 egress 프록시는 그리지 않았다. 빌드 Job에서 밖으로 나가는 선은 전부 프록시를 거친다.

### 1.5 운영 규칙 ([ADR-002](adr/002-system-architecture.md) 세부)

#### 배치

- VM은 k3s 서버이면서 예비 워커다. 학교 PC는 전부 에이전트 노드다.
- api, Traefik, 빌드 Job은 `nodeSelector`로 VM 노드에 고정한다.
- 학생 Pod는 `required nodeAffinity`로 학교 PC 노드에만 배치한다. VM 노드에는 `NoSchedule` taint를 두고 학생 Pod는 기본적으로 이를 허용하지 않는다. Ready인 학교 PC가 하나도 없을 때만 api가 그 Deployment의 affinity를 학교 PC 조건에서 VM 노드 조건으로 교체하고 VM toleration을 붙인다(둘을 같이 두면 조건이 충돌해 어디에도 배치되지 않는다). 학교 PC가 돌아오면 api의 주기 작업이 affinity를 학교 PC 조건으로 되돌리고 toleration을 뗀다. `preferred nodeAffinity`는 점수일 뿐이라 학교 PC가 있어도 VM에 갈 수 있어 쓰지 않는다.
- GHCR는 private이다. 모든 노드의 k3s `registries.yaml`에 읽기 전용 토큰(`read:packages`)을 넣어 노드 단위로 인증한다. 학교 PC 참여 스크립트가 이 파일을 만들고, 토큰 교체도 같은 스크립트를 다시 돌려서 한다. 이미지를 올리는 쪽은 따로다. 빌드 네임스페이스에 `write:packages` 토큰을 담은 Secret을 두고 빌드 Job에만 마운트한다. 토큰은 VM을 세팅하는 사람이 GitHub에서 만들어 `kubectl create secret`으로 넣고, 교체는 새 토큰으로 Secret을 다시 만든 뒤 이전 토큰을 GitHub에서 폐기하는 것으로 한다(Secret만 바꿔서는 이전 토큰이 살아 있다). 서비스를 접을 때는 Secret과 토큰을 둘 다 지운다. 노드 토큰은 읽기 전용으로 유지하고, 값은 어느 쪽도 레포에 커밋하지 않는다. private 패키지에는 플랜별 무료 한도가 있다(Free 기준 저장 500MB, 전송 월 1GB로 알고 있고, GitHub Actions 밖에서 받는 pull이 전송량에 든다 — 값은 요금 페이지에서 확인해 §7 13번에 적는다). 한도에 닿으면 학생 이미지 패키지를 public으로 바꾼다. 그러면 학생 코드가 담긴 이미지가 공개되므로 업로드 화면에서 미리 알린다.
- 노드가 NotReady가 되면 `tolerationSeconds`를 30초로 줄여 eviction을 빨리 시작한다(기본 5분). 이건 전체 복구 시간이 아니다. NotReady 감지(기본 40초), 재스케줄, 이미지 pull, readiness까지 더한 실제 복구 시간은 PC를 실제로 꺼서 재고 §7 11번에 적는다.
- 학교 PC 켜짐 여부는 k3s 노드의 Ready 상태를 그대로 쓴다. api는 이 값을 읽기만 하고 따로 핑을 보내지 않는다.

#### 실행 격리

학생 코드가 도는 네임스페이스에 Pod Security Admission `restricted`를 강제한다. 그러면 non-root, 호스트 네임스페이스·호스트 경로 금지, 권한 상승 금지, capabilities 전부 drop, seccomp `RuntimeDefault`가 필수가 된다. 거기에 `automountServiceAccountToken: false`, 권한 없는 ServiceAccount, Pod 간 통신을 막는 NetworkPolicy를 더한다. 학생 Pod의 egress는 클러스터 DNS(53)와 인터넷만 허용하고, 클러스터 내부 대역·Tailscale 대역·클라우드 메타데이터 주소(169.254.169.254)는 NetworkPolicy의 `ipBlock`/`except`로 막는다. Pod가 자기 노드로 가는 경로는 NetworkPolicy가 보장하지 않으므로 노드의 호스트 방화벽(nftables)에서 Pod 대역 → 노드 주소를 따로 막고, 실제로 막히는지는 측정한다(§7 6번). 커널은 공유하므로 완전한 격리는 아니고, gVisor 같은 샌드박스 런타임은 이후 확장이다.

#### 빌드 격리

학생 Dockerfile의 `RUN`은 임의 코드 실행이다. 그래서 빌드를 VM 호스트의 Docker 데몬에서 돌리지 않고 k3s Job 안의 rootless BuildKit으로 돌린다. Job에도 학생 Pod와 같은 실행 격리 기준과 requests/limits를 걸고, egress는 클러스터 DNS(53), GHCR, Docker Hub(베이스 이미지), 패키지 저장소, R2 엔드포인트만 허용한다. 이 목록은 도메인 단위인데 NetworkPolicy는 IP만 다루므로, 빌드 네임스페이스에 허용 목록을 가진 HTTP 프록시를 두고 Job의 `HTTP_PROXY`/`HTTPS_PROXY`로 모든 나가는 연결을 그리로 보낸다. NetworkPolicy는 프록시와 DNS 외의 egress를 전부 막는 데만 쓴다. 빌드 Job이 밖에 쓸 때 필요한 자격 증명은 GHCR `write:packages` 토큰과 R2 쓰기 키 둘이고, 둘 다 빌드 네임스페이스의 Secret으로 Job에만 들어간다. BuildKit은 Dockerfile의 `RUN`을 별도 컨테이너에서 돌리므로 Job Pod의 환경 변수와 마운트가 `RUN` 안에서 보이지 않아야 하는데, 이건 실제로 `RUN env; ls /run/secrets`를 넣은 Dockerfile로 확인한다(§7 6번). 빌드가 전부 VM의 공인 IP 하나로 나가므로 Docker Hub의 비로그인 pull 제한에 걸린다. 프록시 뒤의 BuildKit에 Docker Hub 계정으로 로그인한 `config.json`을 Secret으로 넣고, 그래도 모자라면 VM에 pull-through 캐시(`registry:2` mirror)를 둔다.

#### 네트워크 경계

VM 호스트 방화벽은 80/443만 공개하고, SSH와 k3s API(6443), kubelet(10250), flannel(8472/UDP)은 Tailscale 인터페이스에서만 받는다. 학교 PC는 밖에서 들어오는 길이 없으므로 같은 포트를 Tailscale 인터페이스로만 연다. 두 규칙 다 `infra/`의 세팅 스크립트가 만든다.

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
| 13 | GHCR 한도 | private 패키지는 저장·전송 한도가 있고 노드의 pull이 전송량에 든다(§1.5 배치). 학생 이미지 하나 수백 MB면 금방 닿는다 | 요금 페이지에서 현재 값을 확인해 여기 적는다. 닿으면 학생 이미지를 public으로 돌린다. 대안으로 VM에 R2를 백엔드로 쓰는 레지스트리(`registry:2`)를 두면 한도가 없지만 운영할 게 하나 는다 |
| 14 | 학생 코드 입력 경로와 원본 보관 | zip 업로드인지 GitHub URL인지, 원본을 어디 두는지가 비어 있다. URL이면 빌드 Job → GitHub(학생 레포) 선이 생기고 egress 프록시 허용 목록에 `github.com`이 들어간다. 원본 보관 위치는 되돌리기 비싼 데이터 저장소 결정이라 ADR 감이다 | 둘 다 받되 1차는 GitHub URL(학생이 이미 레포를 갖고 있고 업로드 용량 문제가 없다). 원본은 R2의 비공개 버킷에 두고 api가 쓰고 빌드 Job이 읽는다. 정해지면 구성도의 api → R2, 빌드 Job → R2 선에 반영 |
| 15 | 와일드카드 TLS | `*.학생결과물` 인증서는 HTTP 챌린지로 못 받는다. DNS-01(Traefik에 Cloudflare API 토큰)이거나, Cloudflare 프록시를 앞에 두고 origin 인증서를 Traefik에 고정하는 방식이다. 후자면 브라우저 → Cloudflare → Traefik으로 구성도가 바뀌고 VM IP가 가려진다 | Cloudflare 프록시 + Origin CA 인증서. ACME 갱신이 없고 VM IP가 안 드러난다. WebSocket은 통과하지만 요청당 100초 제한이 있으니 학생 앱의 긴 요청은 그 안에 끝나야 한다. 정해지면 구성도와 §6 Traefik 행 수정 |
| 16 | 빌드 동시 실행과 시간 제한 | `npm install` 하나가 1~2GB를 쓴다. 상한이 없으면 업로드 몇 개가 겹칠 때 VM이 먼저 죽는다. 9번은 예비 Pod만 다룬다 | Job에 `activeDeadlineSeconds` 600, 메모리 requests = limits = 2Gi, 빌드 네임스페이스 ResourceQuota로 동시 2개. 넘치면 api가 큐에 쌓고 순서를 web에 보여준다. VM 크기 정한 뒤 숫자 조정 |
| 17 | flannel over Tailscale MTU | `tailscale0`(MTU 1280) 위에 vxlan을 얹으면 큰 응답이 조각나서 끊길 수 있다 | k3s 내장 `--vpn-auth`(Tailscale) 연동을 먼저 시험한다. 그게 MTU를 맞춰 준다. 안 되면 flannel MTU를 1230 아래로 수동 지정. 샘플 앱에서 1MB 응답으로 확인 |
| 18 | 학생 프로젝트의 범위 | Pod에 볼륨이 없어 PC가 꺼지면 SQLite·업로드 파일이 사라진다. DB가 따로 필요한 프로젝트(예: Django + Postgres)는 Pod 하나로 못 돌린다. Traefik은 HTTP/WebSocket만 받고 raw TCP는 안 된다 | "서버 필요"는 HTTP/WS를 듣는 단일 컨테이너, 상태는 재시작 때 사라진다고 정의한다. LLM 분류가 그 밖(별도 DB, TCP 포트)을 감지하면 "지원 범위 밖"으로 표시하고 미리보기만 만든다. [`SRS.md`](SRS.md) 범위 밖에 적는다 |
| 19 | 비밀값과 환경 변수 목록 | 지금 설계만으로 비밀값이 아홉 종류다. 이름을 미리 정해 두지 않으면 세팅하는 날 하나씩 찾는다. ADR-001이 채택되면 §6 표로 옮기고 [`.env.example`](../.env.example)과 이름을 맞춘다. web에 `VITE_SUPABASE_ANON_KEY`가 있는 건 브라우저가 Supabase Auth를 직접 부른다는 뜻인데, 구성도와 §1.3에는 그 선이 없다. 로그인이 브라우저 직접인지 api 경유인지 정하면 둘 다 반영한다 | web(Vercel): `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` / api(k3s Secret): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LLM_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `STUDENT_DOMAIN`(k3s 접근은 ServiceAccount 토큰) / 빌드 Job(빌드 네임스페이스 Secret): `GHCR_WRITE_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `DOCKERHUB_CONFIG_JSON`, `HTTP_PROXY`/`HTTPS_PROXY`(비밀 아님) / Traefik: 15번에 따라 `CF_DNS_API_TOKEN` 또는 없음 / 노드(VM·학교 PC, `infra/` 스크립트가 파일로 생성): `registries.yaml`의 GHCR 읽기 토큰, Tailscale 인증 키(태그 붙은 재사용 키), k3s 노드 토큰 / GitHub Actions(레포 Secrets): `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `TAILSCALE_OAUTH_CLIENT_ID`/`SECRET`(러너용 임시 키), `KUBECONFIG`(배포 전용 ServiceAccount), `GITHUB_TOKEN`(GHCR push, 기본 제공) |
