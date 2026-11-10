# 구현·AI 범위와 출처

> **AI 활용도 10점**과 대회 공개 범위 규칙([`hackathon.md`](hackathon.md) §구현 및 공개 범위)의 근거 문서.
> 발표 부록에 **이 문서의 표를 그대로** 옮긴다.
>
> 갱신 시점 — 같은 커밋에서 고친다:
> - AI 모델·외부 API·라이브러리·데이터셋을 추가/교체/제거할 때
> - 코드에 `MOCK(<id>)`·`SAMPLE(<id>)` 마커를 넣거나 뺄 때 ([`conventions.md`](conventions.md) §1)
> - AI 기능의 검증 상태가 바뀔 때

## 1. 직접 구현 vs 외부 기술

| 구분 | 무엇 | 우리가 한 일 |
| --- | --- | --- |
| 직접 구현 | 검토 하네스(입력 구성 · 프롬프트 · 결과 형식 · 실패 처리), 리뷰 패킷, 플랫폼 서버의 배포 설정 초안(레포 설정 파일로 프레임워크 판별, 규칙 코드) · 보안 검사 호출 · 쿠버네티스 호출 모듈(비밀값 · 조치 · 조회), 배포 파이프라인 정의(매니페스트 생성 · 적용 · 동작 확인 · 되돌리기), 스파이크 판정 규칙, 클러스터 구성(`Infra/`: 학생 공간 틀 · 권한 · 네트워크 정책) | 우리가 설계 · 구현 |
| 외부 기술 | React + TypeScript (Vite), Nest.js, FastAPI (FE · BE 버전은 각각 `FE/package.json` · `BE/package.json`에 고정, AI는 TBD) | FE는 `FE/`에 Vite 템플릿으로 세팅하고 데모 코드를 제거함(패키지 매니저는 pnpm이고 버전은 `FE/package.json`의 `packageManager`로 고정. lint는 ESLint(typescript-eslint, jsx-a11y), 테스트는 Vitest + Testing Library + jsdom. TypeScript는 typescript-eslint가 7을 지원하지 않아 6.0으로 고정). BE는 `BE/`에 Nest 12(ESM)로 세팅함(pnpm. lint는 ESLint 10(typescript-eslint), 테스트는 Vitest + `@nestjs/testing` + supertest, 설정 읽기는 `@nestjs/config`이고 값 검증은 직접 구현. 헬스 체크 `GET /api/health`, CORS 허용 목록, 오류 응답 형식, 로그인 토큰 검증과 `GET /api/me`(아래 jose 행), 레포 소유 확인 `POST /api/repos/check`와 Dockerfile 확인 `POST /api/repos/dockerfiles`, 배포 설정 초안 `POST /api/repos/deploy-spec`(아래 Supabase · GitHub API 행)가 있고 그 밖의 기능은 구현 전). AI는 구현 전. 프레임워크 사용 |
| 외부 기술 | Tailwind CSS v4 (`@tailwindcss/vite`) | 스타일링 도구. 기본 팔레트를 비우고 흑백 토큰만 `@theme`에 선언. 컴포넌트 6종(Button · Input · Badge · Table · Card · LogBlock)은 직접 구현하고 기성 컴포넌트 키트는 쓰지 않음 |
| 외부 기술 | eslint-plugin-better-tailwindcss (FE devDependency, MIT) | 개발 도구. 린트에서 `theme.css`에 정의되지 않은 Tailwind 클래스(`bg-white` 등)를 막는다. 앱 번들에는 들어가지 않음. `no-unknown-classes`(없는 클래스)와 `no-restricted-classes`(임의값 · 로드하지 않은 굵기 · 그림자 계열) 두 규칙만 켰다 |
| 외부 기술 | react-router (FE dependency, MIT) | 라우팅 라이브러리. `BrowserRouter` · `Routes`는 그대로 쓰고, 경로 6개(`/login` `/signup` `/reset-password` `/dashboard` `/profile` `/deploy/new`)를 직접 이었다. 앞의 셋은 공개, 뒤의 셋은 로그인해야 열리는 보호 라우트(`FE/src/auth/RequireAuth.tsx`)이고 비로그인 방문자는 원래 가려던 경로를 담아 `/login`으로 보낸다. 경로마다 열리는 페이지와 보호 동작을 자동 테스트(`FE/src/App.test.tsx`)로 확인했다. 회원가입 · 비밀번호 재설정 화면은 구현 전 |
| 외부 기술 | Docker 이미지 `node:22-bookworm-slim` (빌드), `nginx:1.27-alpine` (정적 서빙) | `FE/Dockerfile`로 로컬 컨테이너 개발용 이미지를 만든다. 운영 배포는 S3 + CloudFront라 이 이미지는 쓰지 않는다. 이미지 빌드와 nginx 동작(SPA 경로, 캐시 헤더, gzip)은 2026-11-03에 로컬에서 확인했고, CI에서는 이미지를 빌드하지 않는다 |
| 외부 기술 | Docker 이미지 `node:22-bookworm-slim` (BE 빌드 · 실행) | `BE/Dockerfile`로 로컬 컨테이너 개발용 이미지를 만든다. 운영 배포는 EC2다. 이미지 빌드, 헬스 체크 응답, CORS 헤더, root가 아닌 사용자로 실행, 잘못된 설정에서 부팅 중단은 2026-11-04에 로컬에서 확인했고, CI에서는 이미지를 빌드하지 않는다 |
| 외부 기술 | jose (BE에서 Supabase 로그인 토큰 서명 검증, 공개 키 목록 받기 · 캐시) | 라이브러리 사용. 전역 가드(`@Public()` 예외, 401 · 503 구분, 관리자 판단)는 직접 구현. 테스트에서 만든 키로 서명한 토큰으로 위조 · 만료 · 발급자 · 대상 · 관리자 판단 · 인증 서버 장애 경로를 자동 테스트했다. 2026-11-04에 실제 Supabase 프로젝트로 띄워(로컬 · 컨테이너) 공개 키 목록을 받아 위조 토큰을 401로 거부하는 것과, 인증 서버에 닿지 못하면 503인 것을 확인했다. 같은 날 개발용 테스트 계정의 진짜 로그인 토큰으로 `GET /api/me`가 `200`을 주고, 서명이나 `app_metadata`를 바꾼 토큰은 `401`인 것을 확인했다 |
| 외부 기술 | LangChain (배포 전 검토 파이프라인. 복잡해지면 LangGraph로 확장) | 구현 전. 체인 구성과 프롬프트는 직접 설계 |
| 외부 API | LLM API (업체·모델 미정) | 구현 전. 호출 하네스와 시스템 프롬프트는 직접 구현 |
| 외부 기술 | AWS — CodeBuild(빌드), S3 + CloudFront(웹 정적 파일), EC2 한 대(Nest · FastAPI · GoCD 서버. Kafka 브로커는 후순위) | 구현 전. 설정·연동 |
| 외부 기술 | GHCR (학생 앱 이미지 레지스트리, 이미지 공개. [ADR-003](adr/003-registry-ghcr.md)) | 구현 전. 설정·연동 |
| 외부 기술 | Supabase (PostgreSQL, Auth — 이메일 · 비밀번호 로그인, GitHub 계정 연동. [ADR-007](adr/007-login-email-password-github-link.md)) | 로그인 토큰 검증은 구현함. 소유 확인에서 사용자 토큰으로 `GET /auth/v1/user`를 불러 연동한 GitHub ID를 읽음. 프로필 화면의 GitHub 연동(`FE/src/pages/GithubLinkCard.tsx`: 연동 여부 조회 · 연동 시작 · 실패 안내)은 구현했고, 자동 테스트는 Supabase 대역으로 했다. 실제 Supabase에서의 연동은 대시보드 설정(#49) 뒤에 확인한다. 가입 화면(`FE/src/pages/SignupPage.tsx`: 메일 인증 안내 · 재발송 · 오류 안내)은 구현했고, 자동 테스트는 Supabase 대역으로 했다. 실제 메일로 가입 · 인증하는 것은 아직 확인하지 않았다. 비밀번호 재설정 화면은 구현 전 |
| 외부 기술 | @supabase/supabase-js (FE dependency, MIT) | 브라우저에서 Supabase Auth를 부르는 클라이언트 라이브러리. 로그인 · 가입 · 세션 갱신 · GitHub 연동은 이 라이브러리가 하고 플랫폼 서버에는 로그인 API가 없다([auth.md](design/auth.md)). 우리가 한 일은 `FE/src/lib/supabase.ts`에서 클라이언트를 만들고 `VITE_SUPABASE_URL` · `VITE_SUPABASE_PUBLISHABLE_KEY`가 비어 있으면 변수 이름을 담은 오류를 던지게 한 것까지이며, 자동 테스트로 확인했다. 로그인 화면과 세션 유지(`FE/src/auth/AuthProvider.tsx`: 저장된 세션 복원 · 로그아웃 · 세션이 저절로 끝났을 때의 만료 안내)과 서버 401 처리(`FE/src/lib/api.ts`, 동작은 [auth.md](design/auth.md))를 구현했고 자동 테스트로 확인했다(실제 Supabase 대신 대역으로). 가입 화면(`FE/src/pages/SignupPage.tsx`)도 구현했고 자동 테스트로 확인했다(대역으로). 비밀번호 재설정 화면은 구현 전 |
| 외부 API | GitHub API — 봇 계정의 fork·PR 생성, 계정 연동(OAuth, Supabase Auth가 처리), 레포 소유자 조회 | 레포 소유자 조회(`GET /repos/{소유자}/{레포}`, 인증 없이 공개 레포만, 서버 IP당 시간당 60번)는 구현함. 접수할 commit 확정(`GET /repos/{소유자}/{레포}/commits/HEAD`를 `Accept: application/vnd.github.sha`로 부르면 SHA 텍스트만 옴, 같은 한도)은 AI 없이 구현함. Dockerfile 유무 확인(`GET /repos/{소유자}/{레포}/git/trees/HEAD?recursive=1`, 같은 한도)은 AI 없이 파일 이름으로 판별하고 구현함. 배포 설정 초안은 `commit`을 주면 `commits/{sha}`로 commit인지 확인한 뒤(`git/trees/{sha}`) 같은 파일 목록에서 `package.json`을 찾아 `raw.githubusercontent.com`(인증 없이, API 한도에 잡히지 않음)으로 내용을 읽고 구현함. fork·PR 생성은 구현 전이다. 계정 연동 화면(프로필)은 구현했고 승인 화면 자체는 GitHub가 그린다 |
| 외부 기술 | Apache Kafka (EC2 단일 브로커) | 후순위 (EC2 용량이 남으면, 2026-11-09). 구현 전 |
| 외부 기술 | GoCD (배포 파이프라인. 서버는 EC2, 실행기는 리더. [ADR-009](adr/009-deploy-runs-on-leader-gocd-agent.md)) | 구현 전. 파이프라인 정의는 직접 작성한다. ArgoCD로 바꿀지 검토 중 |
| 외부 기술 | vLLM v0.32.0 + Qwen3-8B-AWQ (리더 GPU에서 도는 로컬 모델, Apache-2.0), NVIDIA device plugin v0.20.1 | 팀 일정상 후순위(2026-11-09 회의)라 데모 경로 밖. 리더에 설치 · 시험함(2026-11-09): 컨텍스트 16K, 동시 요청 1, KV 캐시 FP8, 클러스터 안에서만 API 키로 답한다. 설정은 [`Infra/gpu/`](../Infra/gpu/) · [`Infra/vllm/`](../Infra/vllm/), 값과 이유는 [`design/cluster.md`](design/cluster.md) §11. EC2에서 부르는 길과 AI 서버 연동은 구현 전 |
| 외부 기술 | k3s v1.37.2 (내장 etcd · flannel host-gw · Traefik Ingress 포함. CoreDNS는 k3s 것을 끄고 같은 이미지로 직접 띄움), nvidia-container-toolkit(리더에 받은 상태로 있음. k3s가 런타임으로 잡았고 vLLM 단계에서 쓴다) | 설치 · 설정(2026-11-07, 세 노드). 설정은 [`Infra/k3s/`](../Infra/k3s/) · [`Infra/coredns/`](../Infra/coredns/), 값과 시험 결과는 [`design/cluster.md`](design/cluster.md) §3 · §4. 재부팅 시험 통과(2026-11-08). 학생 공간 양식(쿠버네티스 기본 기능인 Pod Security · ResourceQuota · LimitRange와 k3s의 NetworkPolicy)은 설정만 직접 작성해 적용 · 시험함(2026-11-10, [`Infra/student/`](../Infra/student/), 결과는 §6. 시험에는 공개 이미지 podinfo · curl · busybox만 쓰고 시험 뒤 지운다. 인터넷 쪽 시험 대상은 github.com(HTTPS), portquiz.net(3306, 모든 포트에 답하는 포트 시험 서버), Supabase 풀러 aws-0-ap-northeast-2.pooler.supabase.com(5432)이고 연결만 열어 본다). Traefik을 워커에 묶기는 아직 |
| 외부 기술 | Prometheus (node-exporter · cAdvisor · kube-state-metrics · blackbox-exporter), Grafana | 구현 전. 설정·연동 |
| 외부 기술 | Tailscale (플랫폼 서버 ↔ 리더 연결, 운영자 원격 접속. [ADR-004](adr/004-server-cluster-link-tailscale.md)) | 운영자 원격 접속은 설정함(2026-11-05, 세 노드). 플랫폼 서버 연결은 구현 전 |
| 외부 기술 | 노드 OS 도구 — ufw(호스트 방화벽), netplan(노드 주소), iperf3(노드 사이 속도 측정), Clonezilla(반납용 디스크 이미지) | 설정 · 사용(2026-11-04 ~ 06). 규칙 · 값은 [`design/cluster.md`](design/cluster.md) §1 ~ §3 |
| 외부 기술 | 로그 수집기 · 저장소 — 두지 않는다 (2026-11-09). 스파이크 판정 순간 플랫폼 서버가 쿠버네티스 API로 그 프로젝트 로그를 읽어 Supabase에 스냅샷으로 남긴다. 시계열 DB도 두지 않는다([ADR-006](adr/006-metrics-on-leader-prometheus.md)) | 쓰지 않음. 스냅샷은 직접 구현(구현 전) |
| 외부 기술 | 보안 검사 도구 (후보: 의존성 취약점 Trivy · OSV-Scanner, 비밀값 gitleaks. 플랫폼 서버가 돌린다, [ADR-010](adr/010-repo-analysis-and-security-scan-in-platform-server.md)) | 후보. 구현할 때 하나 고르고 확정되면 여기 올린다 |
| 외부 기술 | Cloudflare Tunnel (학생 서비스 공개 진입, 리더에서 실행) | 예정. 학교망이 터널 포트(TCP 7844)를 통과시키는 것은 확인함(2026-11-06). 설치 전 |
| 외부 기술 | 레지스트리 캐시 `registry:3.1.2` (CNCF Distribution, GHCR 끌어오기 모드, 리더에서 실행, Apache-2.0) | 설치 · 시험함(2026-11-10): 같은 이미지를 두 번째 워커는 캐시에서 1.1초에 받고 GHCR에서는 한 번만 받음, 캐시를 끄면 노드가 GHCR에서 직접 받음. 설정만 직접 작성(`Infra/registry-cache/`, `Infra/k3s/registries.yaml`) |
| 외부 기술 | 클러스터 밖 백업 보관처 (리더 상태 스냅샷, 후보 Cloudflare R2) | 후순위 |

## 2. AI 기능

심사위원이 묻는 것: AI가 **무엇을** 하고, **얼마나 믿을 만**하고, **사람은 어디서** 개입하는가.

| 기능 (FR) | 모델 / API | AI 역할 | 사람의 결정 지점 | 검증 상태 | 검증 방법·결과 |
| --- | --- | --- | --- | --- | --- |
| (FR 미정) 배포 전 보안 검토 | LLM API (업체·모델 미정), LangChain | 레포의 코드·설정에서 보안 위험을 근거와 함께 지적하고(학생이 고른 유형과 AI 분류도 대조, 새 버전은 이전 승인 버전 대비 diff 중심으로 검토), 수정 제안을 봇 계정 PR로 올린다 | 차단 등급은 코드가 자동 차단, 그 외는 운영자가 리포트를 읽고 승인 | 미적용 | 구현 전 |
| (FR 미정) 운영자용 레포 핸드아웃 | LLM API (업체·모델 미정), LangChain | 레포에 문서가 없을 때 프로젝트 요약·구조·엔트리포인트를 SHA permalink와 함께 만들어 운영자 리뷰 패킷에 넣는다. "AI 추정"으로 표기한다 | 운영자가 읽고 승인 / 수정 요청 / 차단을 결정 | 미적용 | 구현 전 |
| (FR 미정) 봇 PR용 Dockerfile 생성 | LLM API (업체·모델 미정), LangChain | 레포에 `Dockerfile`이 없을 때 학생이 고른 유형과 진입점 분석으로 서비스 스펙과 서비스별 `Dockerfile`을 만들어 봇 PR에 넣는다 | 학생이 PR을 반영하고, 반영된 새 SHA는 다시 검토·운영자 승인을 거친다 | 미적용 | 구현 전. 생성물의 안전성 검증 방법 미정 ([시스템 정의서](system-definition.md) §6) |
| (FR 미정) 비용 추정 | LLM API (업체·모델 미정) | AWS 요금표와 자원 사용 지표 두 가지를 한 번 받아 "대충 이 정도 나온다"는 월 추정을 한 줄로 알려 준다 (러프한 추정, 정확한 청구액 아님) | 사람의 결정 없음. 화면에 "추정·참고용"으로 표기한다 | 미적용 | 구현 전. 요금표 단가로 손계산한 값과 비교해 오차를 확인한다 (곱셈을 코드로 하고 AI는 설명만 할지는 [시스템 정의서](system-definition.md) §6) |
| (FR 미정) 운영 중 스파이크 해석 | LLM API (업체·모델 미정) | 스파이크 알림이 난 뒤에만 호출되어 원인을 추정해 쉬운 말로 설명하고 다음 행동을 제안한다 (조치는 하지 않는다. 상시 분석은 없다) | 학생이 제안을 버튼으로 실행하거나 무시한다. 새 버전(이미지 갱신)은 운영자가 승인한다 | 미적용 | 구현 전. 코어 범위다 ([시스템 정의서](system-definition.md) §4.2) |
| (FR 미정) 스파이크 판정 · 자동 조치 | 없음 (규칙 코드) | AI를 쓰지 않는다. 규칙 두 개(메모리 한도 초과 · 크래시 루프)를 플랫폼 서버의 코드가 판정해 자동으로 중단 · 재시작한다 | 학생이 사후에 이벤트 로그로 확인한다 | 미적용 (AI 아님) | AI 대신 규칙 코드가 한다 |
| (FR 미정) 차단 등급 자동 차단 | 없음 (규칙 코드) | AI를 쓰지 않는다. 검토 결과의 차단 등급을 플랫폼 서버의 코드가 자동 차단한다 | 그 외는 운영자가 승인 / 수정 요청 / 차단을 결정 | 미적용 (AI 아님) | AI 대신 코드가 한다 |
| (FR 미정) 취약점 스캔 | 결정적 스캐너 (후보 Trivy · OSV-Scanner) | 스캐너가 의존성 취약점을 찾고, LLM은 결과를 설명만 한다 | 운영자가 리뷰 패킷에서 확인 | 미적용 | 구현 전. 탐지는 AI가 아니라 도구가 한다 |
| (FR 미정) 배포 설정 초안 | 없음 (규칙 코드) | AI를 쓰지 않는다. 플랫폼 서버가 레포 설정 파일(package.json · 락 파일 이름)로 프레임워크 · 언어 · 패키지 매니저 · 명령 · 출력 폴더 · 포트 기본값을 판별해 배포 설정을 미리 채운다. 진입점은 아직 판별하지 않는다 | 학생이 확인하고 고친다 | 미적용 (AI 아님) | AI 대신 규칙 코드가 한다. 초안 조회 API(`POST /api/repos/deploy-spec`)는 구현함: `package.json`과 락 파일 이름으로 Vite + React · Next.js · 언어 · 패키지 매니저 · 설치 · 빌드 · 시작 명령을 판별하고, 모르면 "판단 필요"로 둔다. README는 읽지 않고 락 파일 내용도 읽지 않는다. 이 초안 API는 진입점 · 환경변수(#43) · 백엔드 프레임워크(Nest 등)를 판별하지 않고, 확정한 값을 저장하는 API는 구현 전이다 |
| FR-NNN | | | | 검증됨 / 미검증 / 미적용 | |

검증 상태:

- **검증됨** — 정해진 입력 세트로 돌려 결과를 확인했다. 방법과 숫자를 적는다 (예: "샘플 30건 중 26건 정답").
- **미검증** — 동작은 하지만 정확도를 확인하지 않았다. 발표에서 그렇게 말한다.
- **미적용** — 계획했지만 구현하지 않았다. AI 대신 무엇이 그 일을 하는지 적는다.

## 3. 모킹 · 샘플 · 테스트 계정

코드 마커와 1:1. 이 표에 없는 마커가 코드에 있으면 안 된다.

| ID | 종류 | 위치 | 무엇이 가짜/준비된 것인가 | 시연에 나오나 |
| --- | --- | --- | --- | --- |
| `example-id` | MOCK / SAMPLE / 테스트 계정 | `BE/...` | | 예 → 영상에 `모킹` 표시 / 아니오 |

테스트 계정의 비밀번호는 여기 적지 않는다 — README와 제출 폼에만.

## 4. 데이터 · 오픈소스 · 근거 출처

| 항목 | 출처 (URL) | 라이선스 / 이용 조건 | 어디에 썼나 |
| --- | --- | --- | --- |
| 클라우드 요금표 (AWS 먼저, Vercel · Cloudflare는 시간이 남으면) | AWS Price List ([문서](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/finding-prices-in-service-price-list-files.html)), Vercel · Cloudflare 공개 요금 페이지 | 공개 가격 정보. 기준일을 표기하고 손으로 관리한다 | 비용 추정의 입력 (AI가 요금표와 지표로 월 추정치를 계산, 추정 · 참고용) |
| 선행 사례 — 부산대 2024 졸업과제(컨테이너 오케스트레이션 기반 서버리스 프로젝트 배포 시스템) | [기술보고서 2024-10](https://snbl.pusan.ac.kr/bbs/cse/12607/916565/download.do) | 공개 보고서. 아이디어만 비교하고 코드·문구는 가져오지 않는다 | [SRS](SRS.md) §1.4 비교 |
| 기존 서비스 비교 조사 (Cloudtype, KT·NHN·Naver Cloud, Coolify 등) | [Coolify CVE-2026-34057](https://nvd.nist.gov/vuln/detail/CVE-2026-34057) 외 각 제품 문서·블로그. 2026-10-31 조사, **2차 출처가 많다** | 공개 정보. 가격·기능은 발표 전 공식 문서로 재확인한다 | [SRS](SRS.md) §1.4 비교 (AI 기능이 아님) |
| LLM 코드 리뷰어 우회 사례 (큰 파일에 악성 로직을 묻으면 탐지율이 떨어진다는 보도) | [Security Brief Asia](https://securitybrief.asia/story/cloudflare-warns-of-ai-code-review-prompt-injection) — **2차 보도, 원문 미확인** | 공개 기사 | §5 "AI 검토는 단독 판정자가 아니다"의 근거 |
| 무료 코드 실행 환경 남용 사례 (Heroku 무료 플랜 폐지) | [TechCrunch 2022-08-25](https://techcrunch.com/2022/08/25/heroku-announces-plans-to-eliminate-free-plans-blaming-fraud-and-abuse) | 공개 기사 | 승인 게이트의 필요성 근거 |
| 나눔스퀘어 네오 (글꼴) | [네이버 한글한글아름답게 글꼴 안내](https://hangeul.naver.com/font), 웹폰트 CSS `hangeul.pstatic.net/hangeul_static/css/nanum-square-neo.css` | 안내 페이지 기준: 무료, 글꼴 자체를 판매하는 경우를 뺀 상업적 사용 가능, 출처 표기 권장. 라이선스 전문(OFL)은 직접 열어 보지 않았다 | 본문 · 제목 (FE, CDN으로 불러오며 저장소에 파일을 넣지 않음) |
| 나눔고딕코딩 (글꼴) | [Google Fonts](https://fonts.google.com/specimen/Nanum+Gothic+Coding) (소스: `google/fonts` 저장소 `ofl/nanumgothiccoding/OFL.txt`가 존재함을 확인) | SIL OFL 1.1. 전문 내용은 직접 읽지 않았다 | 로그 · 코드 블록 (FE, CDN) |
| | | | |

[`SRS.md`](SRS.md) §1.1 문제 근거의 출처도 여기에 함께 올린다.

## 5. 알려진 한계

발표 "실제 결과 · 오류와 한계"에 그대로 쓴다. 감추면 질의응답에서 잃는다.

- **AI 검토는 단독 판정자가 아니다.** 큰 파일에 악성 로직을 묻으면 놓칠 수 있다는 보도가 있다 (2차 출처, 원문 확인 필요). 그래서 결정적 스캐너 · 운영자 승인 · NetworkPolicy와 쿼터를 겹쳐 쓴다. 정확도는 우리가 직접 측정한 수치만 발표한다.
- **컨테이너 격리는 완전하지 않다.** k3s 기본 런타임은 호스트 커널을 공유한다. 기본 차단 NetworkPolicy · 쿼터 · 비루트 실행과 운영자 승인으로 보완하고, 강한 격리(gVisor 등)는 하지 않는다 (설정 방법은 미확인).
- **리더가 단일 장애점이다.** 승격은 범위 밖이다. 터널이 리더에 있어 리더가 꺼지면 방문자도 들어오지 못한다(터널을 워커로 옮기는 것은 후순위). 스위치와 벽 랜 포트(인터넷 길)도 단일 장애점이다. 정전 · 인터넷 길 끊김 · 디스크 가득 참이 흔한 실패 원인이다.
- **도메인은 11/11 연결을 목표로 한다.** 그 전에는 주소가 바뀔 수 있다. 연결 범위와 DNS 서비스 · 게이트웨이는 한계로 말한다.
- **학생 DB는 학생 것이다(MVP, 2026-11-07).** 플랫폼은 학생 DB를 띄우거나 백업하지 않는다. 학생 데이터의 보존은 학생 DB 쪽 책임이다.
- **리더 상태 스냅샷의 클러스터 밖 백업은 후순위다.** 그것이 들어가기 전까지는 리더 디스크가 죽으면 클러스터를 다시 세워야 한다.
