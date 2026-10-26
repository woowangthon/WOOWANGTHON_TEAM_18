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
3. api가 k3s에 빌드 Job을 만든다. Job은 rootless BuildKit으로 결과물을 만든다.
4. 분류 결과에 따라 다르게 처리한다.

| 실행 방식 | 처리 | 실행 위치 |
| --- | --- | --- |
| 정적 | 파일을 R2에 올려 학생 결과물 도메인으로 바로 공개한다 | R2 |
| 브라우저 실행 | 빌드 Job이 빌드한 결과를 R2에 올려 공개한다 | R2 |
| 서버 필요 | 빌드 Job이 이미지를 만들어 GHCR에 올리고, k3s 서버가 Deployment·Ingress로 배치한다 | 학교 PC 우선, 없으면 클라우드 VM |

5. 사용자 요청은 VM의 Traefik이 받아 Tailscale 위로 해당 Pod에 전달한다. 학교 PC가 꺼지면 k3s가 감지해 다른 노드로 재배치한다(복구 시간은 §7 11번).
6. 학교 PC도 VM 자리도 없으면 R2에 저장해 둔 정적 미리보기만 보여준다.

### 1.2 영역과 구성 요소

| 영역 | 구성 요소 | 역할 |
| --- | --- | --- |
| 개발 영역 | 개발자 (팀원 3명) | 코드 작성, PR |
| | GitHub | 모노레포 `WOOWANGTHON_TEAM_18` (폴더 구조는 [ADR-001](adr/001-stack.md)) |
| | GitHub Actions | 테스트, 빌드. web은 Vercel로, api 이미지는 GHCR로, 클러스터 배포는 Tailscale 위 `kubectl`로 |
| | GHCR | api 이미지와 학생 프로젝트 이미지 (private). 노드마다 k3s `registries.yaml`의 읽기 전용 토큰으로 받는다 |
| Vercel | web (React) | 우리 서비스 웹사이트 |
| 클라우드 VM – Main (항상 켜짐) · k3s 서버 노드 | k3s 서버 | 클러스터 관리, Pod 배치, 노드 상태 |
| | Traefik (k3s 내장) | Ingress, TLS, 요청 분배 (api, 학생 앱) |
| | api (FastAPI) Pod | 업로드 처리, 분석 요청, 빌드 Job·Deployment·Ingress 생성. VM 노드에 고정 |
| | 빌드 Job (rootless BuildKit) | 학생 코드 → 이미지(GHCR) 또는 정적 결과물(R2). VM 노드에 고정 |
| | 학생 프로젝트 Pod (예비) | 학교 PC가 하나도 없을 때만. api가 toleration을 붙여 배치하고, PC가 돌아오면 되돌린다 |
| 외부 서비스 | Supabase | PostgreSQL(사용자, 프로젝트, 실행 기록), Auth(로그인) |
| | LLM API | 코드 분석, 실행 방식 분류, 위험 코드 표시 |
| | Cloudflare R2 | 정적 결과물, 미리보기. 학생 결과물 도메인으로 공개 |
| Tailscale 사설망 | — | VM과 학교 PC를 잇는 통로. 학교 PC는 방화벽 안이라 밖에서 들어오는 다른 길이 없고, k3s는 `--node-ip`를 Tailscale 주소로, `--flannel-iface`를 `tailscale0`으로 줘서 노드 간 통신을 이 위로 보낸다. 설정은 `infra/`에 둔다 |
| 학교 실습실 PC · k3s 에이전트 노드 (켜져 있을 때만 참여) | k3s 에이전트 | 지시받은 Pod 실행, 노드 상태 보고 |
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
| 검정 | 사용자 요청 | 브라우저 → web(Vercel) / 브라우저 → Traefik → api / 브라우저 → Traefik → (Tailscale) → 학생 Pod (학교 PC 또는 VM 예비) / 브라우저 → R2 (정적 프로젝트, 미리보기) |
| 파랑 | 코드 배포 (CI/CD) | 개발자 → GitHub → GitHub Actions → web(Vercel), GHCR(api 이미지), k3s 서버(배포) |
| 주황 | AI 분석 | api ↔ LLM API |
| 초록 | 학생 프로젝트 실행 | api → k3s 서버(Job·Deployment·Ingress 생성) / k3s 서버 → 빌드 Job → GHCR(이미지 올림) / k3s 서버 → (Tailscale) → 학교 PC(우선 배치) / k3s 서버 → VM 예비 Pod(학교 PC 없을 때) / 학교 PC → GHCR(이미지 받음, 학교망 직접) |
| 보라 | 데이터 | api ↔ Supabase / 빌드 Job → R2 |
| 회색 점선 | 상태 확인 | 학교 PC → k3s 서버 (노드 Ready) |

### 1.4 구성도 참고

- 학교 PC 쪽 화살표는 PC마다 긋지 않고 실습실 영역 테두리에 연결했다.
- Traefik → 학생 Pod 화살표는 학교 PC와 VM 예비 Pod 둘 다를 뜻한다. 구성도에는 실습실 쪽 하나만 그렸다.
- draw.io 내장 라이브러리에 아이콘이 없어 회색 점선 상자로 자리만 잡아 둔 구성 요소: GitHub Actions, GHCR, React, Traefik, Cloudflare R2, LLM API.

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

비밀값은 배포처 환경 변수에만 둔다. 여기에는 **변수 이름만** 적는다.

## 7. 정해야 할 것

아키텍처([ADR-002](adr/002-system-architecture.md))에서 아직 정하지 않은 항목. 정해지면 되돌리기 비싼 것은 ADR로, 나머지는 이 문서의 해당 절에 반영하고 여기서 지운다.

| # | 항목 | 고민할 점 | 제안 |
| --- | --- | --- | --- |
| 1 | "정적 미리보기"의 정의 | 서버 필요 프로젝트의 미리보기가 화면 스크린샷인지, 백엔드 없이 프론트만 띄운 것인지. 스크린샷이면 누가 언제 찍는지 | 정해지면 구성도에 반영 |
| 2 | 학생 결과물 도메인 구성 | 서비스(`app.example.com`)와 학생 결과물(`example-usercontent.com`)은 분리한다. 정적(R2 커스텀 도메인)과 서버 필요(`<프로젝트>.` 와일드카드 → Traefik)를 한 도메인 아래 어떻게 나눌지, 도메인 구매와 DNS를 누가 맡을지 | Cloudflare DNS 하나로 관리. `static.`은 R2, `*.`는 VM Traefik |
| 3 | PC 사용자 몫 예약 값 | 수업 중에는 사람이 PC를 쓴다. 학생 프로젝트가 PC를 느리게 만들면 학교가 참여를 막을 수 있다 | `system-reserved` CPU 2코어·메모리 6GB, `kube-reserved` 0.5GB, `eviction-hard` memory.available<500Mi부터 시작해 측정 후 조정 |
| 4 | Pod 자원 기본값 | requests/limits가 없으면 무한루프 하나가 같은 PC의 다른 프로젝트까지 죽인다. 메모리는 limits가 requests보다 크면 스케줄러가 센 수보다 실제 사용이 커져 노드가 터질 수 있다 | 메모리 requests = limits = 256Mi(Guaranteed), CPU requests 100m · limits 500m(CPU는 넘쳐도 느려질 뿐이라 오버커밋 허용). 노드당 `max-pods` 40. 측정 후 조정 |
| 5 | 안 쓰는 프로젝트 내리기 | 아무도 보지 않는 프로젝트를 계속 켜 두면 자원 낭비다. replicas가 0이면 그 주소로 온 요청을 받을 Pod가 없으므로 깨우는 경로가 따로 있어야 한다 | 마지막 접속 후 30분이 지나면 api가 학생 Deployment의 replicas를 0으로 내리고 그 Ingress를 api의 깨우기 페이지로 돌린다. 접속이 오면 그 페이지가 replicas를 1로 올리고, 준비되면 Ingress를 원래대로 되돌린다 (몇 초에서 수십 초) |
| 6 | 격리 수준 | 한 PC에 서로 다른 학생의 코드가 같이 돈다. ADR-002의 실행 격리 기준(PSA `restricted`, ServiceAccount 토큰 비마운트, NetworkPolicy)을 걸어도 커널은 공유한다 | 그 기준을 최소선으로 매니페스트에 박는다. NetworkPolicy와 호스트 방화벽이 메타데이터 주소·Tailscale 대역·자기 노드를 실제로 막는지 학생 Pod 안에서 `curl`로 확인한다. gVisor 같은 샌드박스 런타임을 넣을지, 넣는다면 언제인지 정한다 |
| 7 | 위험 코드 처리 | LLM이 위험 코드를 표시한 뒤 실행을 막는지, 경고만 하는지 | 팀 논의 |
| 8 | AI 역할 범위 | 분류와 위험 표시만 할지, 실행 계획(Dockerfile·빌드 명령·포트·환경변수)까지 제안하고 학생이 승인하게 할지. 주제 "AI는 동료가 될 수 있을까?"의 답이 이 흐름에 들어간다 | 실행 계획까지. [`SRS.md`](SRS.md) "AI 동료의 역할 경계"와 함께 정한다 |
| 9 | VM 예비 노드 용량 | VM 크기와, 학교 PC가 없을 때 VM에 동시에 띄울 학생 Pod 수 상한 | 네임스페이스 ResourceQuota로 상한. 값은 VM 업체·크기 정한 뒤 |
| 10 | 심사 기간 운영 | 2026-11-15 제출 마감부터 11.16–20 사전 심사, 11.21 본선까지([`hackathon.md`](hackathon.md) §일정) 학교 PC가 꺼져 있다고 가정하고 VM만으로 시연이 되어야 한다. Supabase 무료 플랜은 지난 7일간 DB 활동이 충분하지 않으면 프로젝트를 일시 정지한다. 공식 문서는 "하루에 몇 번의 요청이면 보통 충분"이라고 하고, 정지 일주일 전에 경고 메일이 온다 ([문서](https://supabase.com/docs/guides/platform/free-project-pausing), 2026-10-26 확인) | 시연용 프로젝트는 VM에 미리 띄워 둔다. api가 한 시간에 한 번 DB에 가벼운 쿼리를 보내는 작업을 돌리고, 경고 메일이 오면 대시보드에서 바로 확인한다. 불안하면 심사 주간만 Pro 플랜으로 올린다 |
| 11 | 노드 장애 복구 시간 | NotReady 감지 → eviction → 재스케줄 → 이미지 pull → readiness. `tolerationSeconds` 30초는 그중 한 구간이다 | 시연 전에 PC를 실제로 꺼서 끝에서 끝까지 시간을 재고 목표를 정한다 |
