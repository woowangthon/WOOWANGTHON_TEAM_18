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

4. 빌드·실행 상태는 api가 k3s에서 로그와 상태를 읽어 web에 보여준다 (전송 방식은 §3 API 계약에서 정한다).
5. 요청은 VM의 Traefik이 받아 Tailscale 위로 Pod에 보낸다. 학교 PC가 꺼지면 k3s가 다른 학교 PC로 옮기고, 전부 없으면 api가 VM으로 돌린다 (복구 시간은 §7 11번).
6. Pod가 없는 프로젝트의 요청은 api 안내 페이지로 간다. 깨울 수 있으면 깨우고(§7 5번), 아니면 R2 미리보기로 보낸다.

### 1.3 구성 요소와 규칙

규칙 칸은 [ADR-002](adr/002-system-architecture.md)의 세부다. 값은 §7에서 조정한다.

| 어디 | 무엇 | 역할 | 규칙 |
| --- | --- | --- | --- |
| 개발 | GitHub · GitHub Actions | 모노레포([ADR-001](adr/001-stack.md)). Actions가 web은 Vercel CLI로, api 이미지는 GHCR로, 클러스터는 Tailscale 위 `kubectl`로 배포. 업타임 cron도 여기 | — |
| | GHCR | api·학생 프로젝트 이미지 | 비공개. 노드는 읽기 토큰(참여 스크립트가 넣고 교체), 빌드 Job만 쓰기 토큰 Secret. 교체 시 이전 토큰은 GitHub에서 폐기. 무료 한도에 닿으면 학생 이미지를 공개로 돌리고 업로드 화면에서 미리 알린다 (§7 13번) |
| Vercel | web (React) | 우리 서비스 웹사이트. 학생 코드는 안 들어간다 | — |
| 클라우드 VM (항상 켜짐) | k3s 서버 | 클러스터 관리, 배치, 노드 상태. 학교 PC가 조인하는 대상 | 학생 Pod는 학교 PC에만 둔다 (`required nodeAffinity`), VM은 평소 거부 (`NoSchedule` taint). 켜진 학교 PC가 없으면 api가 조건을 VM으로 바꾸고 돌아오면 되돌린다. PC가 꺼지면 30초 뒤 옮긴다 (`tolerationSeconds`). 켜짐 여부는 노드 Ready 그대로 |
| | Traefik (k3s 내장) | Ingress·TLS. api와 학생 앱 라우팅. Pod 없는 프로젝트는 api 안내 페이지로 | — |
| | api (FastAPI) | 업로드, 분석 요청, k3s 리소스 생성·수정, 상태·로그 조회, 정적 프로젝트 R2 업로드 | VM 고정 (`nodeSelector`). 권한은 학생 네임스페이스의 `jobs`·`deployments`·`ingresses`·`pods/log`와 `nodes` 읽기 |
| | 빌드 Job (rootless BuildKit) | 학생 코드 → 이미지(GHCR) 또는 정적 결과물(R2) | VM 고정. Dockerfile `RUN`은 아무 코드나 돌리니 호스트 Docker 대신 Job 안에서 root 없이. 학생 Pod와 같은 격리와 자원 제한. 밖으로는 허용 목록 프록시(GHCR, Docker Hub, 패키지 저장소, R2)만. 비밀은 GHCR 쓰기 토큰·R2 키 둘, `RUN`에서 안 보이는지 확인 (§7 6번). Docker Hub는 로그인 Secret, 모자라면 캐시 |
| | 학생 Pod (예비) | 학교 PC가 하나도 없을 때만 | 학교 PC의 학생 Pod와 같은 규칙 |
| 외부 | Supabase | PostgreSQL(사용자·프로젝트·실행 기록), Auth | — |
| | LLM API | 분류, 위험 코드 표시 | — |
| | Cloudflare R2 | 학생 정적 결과물·미리보기. S3 호환, egress 무료, 학생 결과물 도메인으로 공개 | — |
| | Docker Hub · 패키지 저장소 | 빌드가 받는 베이스 이미지·의존성 | 프록시를 통해서만 |
| Tailscale | — | VM과 학교 PC를 잇는 사설망. 학교 PC는 방화벽 안이라 이 길뿐 | VM은 80/443만 밖에 열고 SSH·6443·10250·8472/UDP는 Tailscale에서만. 학교 PC도 같은 포트를 Tailscale에서만. k3s는 Tailscale 주소를 노드 주소로 쓴다 (`--node-ip`, `--flannel-iface tailscale0`, MTU는 §7 17번) |
| 학교 실습실 PC (켜져 있을 때만) | k3s 에이전트 · 학생 Pod ×N | 서버 필요 프로젝트 실행. 이미지는 학교망에서 직접 받는다 | 참여 순서: Tailscale 로그인 → `registries.yaml` → 조인. PC당 여러 Pod: 16GB에서 사용자 몫(§7 3번)을 빼면 약 9GB, 256Mi면 약 36개, `max-pods` 40 (§7 4번). 학생 Pod는 root 아님·호스트 접근 금지·권한 상승 금지 (PSA `restricted`), 클러스터 토큰 없음, Pod 간 통신 차단, 밖으로는 DNS와 인터넷만(클러스터·Tailscale 대역과 169.254.169.254 차단), 자기 PC로 가는 길은 nftables로 차단 (§7 6번). 커널은 공유, gVisor는 이후 |

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

[ADR-002](adr/002-system-architecture.md)에서 아직 정하지 않은 항목. 되돌리기 비싼 것은 ADR로, 나머지는 해당 절에 반영하고 여기서 지운다. 번호는 ADR이 참조하므로 바꾸지 않는다.

| # | 항목 | 고민할 점 | 제안 |
| --- | --- | --- | --- |
| 1 | 정적 미리보기의 정의 | 서버 필요 프로젝트의 미리보기가 스크린샷인지 프론트만 띄운 것인지, 누가 언제 만드는지 | 정하면 구성도에 반영 |
| 2 | 학생 결과물 도메인 | 서비스 도메인과 학생 도메인을 분리한다. R2 하나에 경로로 나누면 같은 origin이라 브라우저 실행 프로젝트가 옆 프로젝트의 localStorage·쿠키를 읽는다 | Cloudflare DNS. 프로젝트마다 `<프로젝트>.도메인`을 주고, 정적도 `*.`를 받는 쪽(Traefik 또는 Cloudflare Worker)이 R2의 `<프로젝트>/` 경로로 넘긴다. 인증서는 15번 |
| 3 | PC 사용자 몫 | 수업 중에는 사람이 쓴다. 느려지면 학교가 참여를 막는다 | `system-reserved` CPU 2코어·메모리 6GB, `kube-reserved` 0.5GB, `eviction-hard` 500Mi. 측정 후 조정 |
| 4 | Pod 자원 기본값 | 없으면 무한루프 하나가 옆 프로젝트를 죽인다. 메모리 limits가 requests보다 크면 노드가 터진다 | 메모리 requests = limits = 256Mi, CPU 100m/500m, 노드당 `max-pods` 40. 측정 후 조정 |
| 5 | 안 쓰는 프로젝트 내리기 | 켜 두면 낭비다. replicas 0이면 깨울 길이 따로 필요하고, "마지막 접속"을 누가 기록하는지도 정해야 한다 | Traefik `forwardAuth`로 api가 접속 시각을 기록. 30분 지나면 replicas 0, Ingress를 깨우기 페이지로. 접속 오면 1로 올리고 되돌린다 |
| 6 | 격리 수준 | 커널은 공유한다 | §1.3 기준을 매니페스트에 박는다. 메타데이터 주소·Tailscale 대역·자기 노드가 막히는지, 빌드 Job Secret이 `RUN` 안에서 안 보이는지 Pod 안에서 확인. gVisor는 시기만 정한다 |
| 7 | 위험 코드 처리 | 실행을 막는지 경고만 하는지 | 팀 논의 |
| 8 | AI 역할 범위 | 분류만 할지 실행 계획(Dockerfile·빌드 명령·포트·환경변수)까지 제안할지. LLM 입력 범위·비용 상한·외부 전송 고지도 없다 | 실행 계획까지, 학생이 승인. 입력은 파일 목록 + 설정 파일 + 진입점 몇 개, 토큰 상한. 업로드 화면에 외부 LLM 전송 고지, [`ai-scope.md`](ai-scope.md) §5에 적는다 |
| 9 | VM 예비 용량 | VM 크기와 동시 학생 Pod 상한 | 네임스페이스 ResourceQuota. VM 정한 뒤 |
| 10 | 심사 기간 운영 | 11.15 마감부터 11.21 본선까지([`hackathon.md`](hackathon.md)) 학교 PC가 꺼져 있다고 가정. Supabase 무료 플랜은 7일 비활성이면 일시 정지([문서](https://supabase.com/docs/guides/platform/free-project-pausing), 2026-10-26 확인) | 시연 프로젝트는 VM에 미리 띄운다. api가 매시간 가벼운 쿼리. 불안하면 심사 주간만 Pro |
| 11 | 노드 장애 복구 시간 | NotReady 감지 → eviction → 재스케줄 → pull → readiness. VM 전환은 pull이 통째로 더해진다 | 시연 전에 PC를 실제로 꺼서 끝에서 끝까지 잰다. 학교 PC → VM도 따로 |
| 12 | 학교에 확인할 것 | ADR-002의 학교 PC 전제는 가정이다 | 전산실에 한 번에: ① 나가는 443과 UDP 41641 ② VPN·P2P 차단 여부 ③ 인증 포털 ④ 재부팅 복원 여부 ⑤ 관리자 권한 ⑥ 배포판·커널 ⑦ 수업 시간표 |
| 13 | GHCR 한도 | private 패키지는 저장·전송 한도가 있고 노드 pull이 전송에 든다 | 요금 페이지에서 확인해 여기 적는다. 닿으면 학생 이미지를 public으로. 대안은 VM에 R2 백엔드 `registry:2` |
| 14 | 코드 입력 경로와 원본 보관 | zip 업로드인지 GitHub URL인지, 원본을 어디 두는지(데이터 저장소라 ADR 감) | 1차는 GitHub URL. 원본은 R2 비공개 버킷에 두고 api가 쓰고 빌드 Job이 읽는다. URL이면 프록시 허용 목록에 `github.com` |
| 15 | 와일드카드 TLS | HTTP 챌린지로는 못 받는다. DNS-01(Traefik에 Cloudflare 토큰)이냐 Cloudflare 프록시 + origin 인증서냐. 후자는 구성도가 바뀌고 VM IP가 가려진다 | Cloudflare 프록시 + Origin CA. 요청당 100초 제한에 유의. 정하면 구성도 수정 |
| 16 | 빌드 동시 실행과 시간 제한 | `npm install` 하나가 1~2GB. 상한 없으면 VM이 먼저 죽는다 | Job `activeDeadlineSeconds` 600, 메모리 2Gi, ResourceQuota로 동시 2개. 넘치면 api가 큐에 쌓는다 |
| 17 | flannel over Tailscale MTU | `tailscale0`(1280) 위에 vxlan을 얹으면 큰 응답이 조각난다 | k3s `--vpn-auth` 연동을 먼저. 안 되면 flannel MTU 1230 이하. 1MB 응답으로 확인 |
| 18 | 학생 프로젝트의 범위 | 볼륨이 없어 상태가 사라진다. DB가 따로 필요한 프로젝트는 Pod 하나로 못 돌리고, raw TCP는 Traefik이 못 받는다 | "서버 필요"는 HTTP/WS 단일 컨테이너, 상태 비보존으로 정의. 그 밖은 "지원 범위 밖" 표시 + 미리보기만. [`SRS.md`](SRS.md) 범위 밖에 적는다 |
| 19 | 비밀값·환경 변수, 로그인 경로 | 비밀값이 아홉 종류다. web에 Supabase anon key가 있다는 건 브라우저가 Auth를 직접 부른다는 뜻인데 구성도에 그 선이 없다 | ADR-001 채택 시 §6으로 옮기고 [`.env.example`](../.env.example)과 맞춘다. web `VITE_API_URL`·`VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY` / api `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`·`LLM_API_KEY`·`R2_ACCOUNT_ID`·`R2_ACCESS_KEY_ID`·`R2_SECRET_ACCESS_KEY`·`R2_BUCKET`·`STUDENT_DOMAIN` / 빌드 Job `GHCR_WRITE_TOKEN`·R2 키·`DOCKERHUB_CONFIG_JSON` / Traefik `CF_DNS_API_TOKEN`(15번에 따라) / 노드: GHCR 읽기 토큰, Tailscale 키, k3s 노드 토큰 / Actions `VERCEL_TOKEN`·`VERCEL_ORG_ID`·`VERCEL_PROJECT_ID`·`TAILSCALE_OAUTH_*`·`KUBECONFIG`. 로그인 경로는 정하면 구성도와 §1.4에 반영 |
