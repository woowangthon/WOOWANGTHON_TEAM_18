# ADR-001: 기술 스택

- **상태**: 제안됨
- **날짜**: 2026-10-25
- **결정자**: TBD
- **관련**: [`SRS.md`](../SRS.md), [`design.md`](../design.md), [`hackathon.md`](../hackathon.md)

## 맥락

해커톤 제약이 스택 선택을 좌우한다 ([`hackathon.md`](../hackathon.md)):

- **3주** (10.24 → 11.15 18:00). 팀원이 이미 써 본 도구가 새 도구보다 낫다.
- **배포 URL이 심사 종료(11.21)까지 살아 있어야 한다.** 무료 티어의 슬립·크레딧 소진·트래픽 제한을 확인한다.
- **평가 버전은 main 커밋 해시**이고, 마감 후에는 같은 커밋의 재배포만 허용된다 → main에서 바로 재현 가능한 배포여야 한다.
- AI 활용도 10점, 미사용 시 0점. 외부 AI API의 비용·속도·키 관리를 고려한다.
- 모노레포 1개.

## 결정

TBD — 아래 표를 채우고 상태를 `채택됨`으로 바꾼다.

선택 칸은 [ADR-002](002-system-architecture.md) 초안(@seren-wib)의 제안이며 팀 합의 전이다.

| 영역 | 선택 | 이유 (한 줄) |
| --- | --- | --- |
| FE | React (Vercel 배포) | |
| BE | FastAPI | |
| AI 모델 / API | LLM API — 업체·모델 미정. API 서버가 직접 호출하며 별도 AI 서버는 없다 | |
| DB | PostgreSQL (Supabase) | |
| 배포 | web: Vercel (GitHub Actions에서 Vercel CLI로 올린다) / api·Traefik·빌드 Job·k3s 서버: 클라우드 VM 위 k3s (업체 미정) / CI·CD: GitHub Actions | 조직 레포라 Vercel Git 연동에는 조직 앱 설치 권한(운영진)이 필요하다. CLI 배포는 토큰 하나면 되고 fork PR에는 토큰이 없어 미리보기도 main 기준으로만 뜬다 |
| 패키지 매니저 · 폴더 구조 | 모노레포. 배포 단위로 `apps/web`(React), `apps/api`(FastAPI, LLM 호출은 `api` 안의 모듈), 설정은 `infra/`(VM·k8s·학교 PC 스크립트) | 따로 배포되는 것만 `apps/`에 둔다. 별도 AI 서버가 없으므로 `ai/` 앱은 두지 않는다 |
| 빌드 도구 (학생 프로젝트) | BuildKit (rootless) — k3s 빌드 Job 안에서 실행, Dockerfile 호환 | |

## 대안

버린 이유는 초안 단계의 판단이며 팀 합의 때 다시 본다. AI 모델 / API는 후보를 비교한 뒤 채운다.

| 영역 | 대안 | 장점 | 버린 이유 |
| --- | --- | --- | --- |
| FE | Next.js | SSR·파일 기반 라우팅 내장, Vercel 배포에 최적화 | 로그인 뒤에 쓰는 대시보드형 화면이라 SSR·SEO 이점이 작다. 서버 컴포넌트까지 다루면 3주 안에 익힐 것이 늘어난다 |
| BE | Node.js (Express / NestJS) | FE와 언어(TypeScript)를 통일할 수 있다 | FastAPI는 Pydantic 모델로 요청·응답 스키마와 OpenAPI 문서를 자동으로 만들어 [`design.md`](../design.md) §3 계약을 코드와 맞추기 쉽다 |
| BE | Spring Boot | 타입 안정성, 국내 백엔드 표준 | 설정과 보일러플레이트가 많아 3주 해커톤에 무겁다 |
| DB | Firebase (Firestore) | 인증·실시간 기능 내장, 서버 없이 쓸 수 있다 | 사용자–프로젝트–실행 기록은 서로 참조하는 관계형 데이터라 조인과 제약 조건이 필요하다 |
| DB | 클라우드 VM에 PostgreSQL 직접 설치 | 무료 티어의 일시 정지·용량 제한이 없다 | 백업·업데이트·접속 관리를 직접 해야 한다 |
| 배포 (BE) | Render 같은 PaaS | 서버 관리가 필요 없다 | k3s 서버와 Tailscale은 호스트 권한이 있는 VM이 필요한데 PaaS는 VM을 주지 않는다([ADR-002](002-system-architecture.md)). 무료 플랜은 15분간 요청이 없으면 잠들고 다음 요청이 1분 가까이 걸리므로, 심사위원의 첫 클릭이 그 지연을 맞는다 |
| 빌드 도구 | Docker (`docker build`), VM 호스트에서 | 가장 단순하다 | 학생 Dockerfile의 `RUN`이 메인 VM에서 root Docker 데몬으로 실행된다 ([ADR-002](002-system-architecture.md) 대안) |
| 빌드 도구 | Kaniko | Docker 데몬 없이 Pod 안에서 이미지를 빌드한다. 같은 용도 | 2025년 6월 저장소가 보관(archived) 처리돼 유지보수가 멈췄다. BuildKit은 `docker build`와 같은 엔진이라 Dockerfile 호환이 가장 넓다 |
| 배포 (FE) | 클라우드 VM의 Nginx로 직접 서빙 | 배포처가 하나로 줄어든다 | Vercel은 main 머지 때 자동 배포하고 PR마다 미리보기 URL을 준다 |

## 결과

채택되면 같은 PR에서 함께 한다:

- [`CLAUDE.md`](../../CLAUDE.md) Commands 블록 채우기
- [`design.md`](../design.md) §1 다이어그램, §6 배포 표 채우기
- [`ai-scope.md`](../ai-scope.md) 외부 기술 표에 선택한 프레임워크·모델 추가
- **CI 작성** — 빌드·테스트 job, 문서 상대 링크 검사, 코드의 `MOCK(id)`·`SAMPLE(id)` ↔ `ai-scope.md` 대조, 배포 URL 업타임 cron(11.21까지), 제출용 `submission` 태그 + main 해시 출력 (수동 실행)
