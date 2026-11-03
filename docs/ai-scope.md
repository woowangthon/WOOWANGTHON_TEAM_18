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
| 직접 구현 | 검토 하네스(입력 구성 · 프롬프트 · 결과 형식 · 실패 처리), 리뷰 패킷, 플랫폼 서버의 배포 매니페스트 생성과 쿠버네티스 호출 모듈, 스파이크 판정 규칙, 클러스터 구성(`Infra/`: 학생 공간 틀 · 권한 · 네트워크 정책) | 우리가 설계 · 구현 |
| 외부 기술 | React + TypeScript (Vite), Nest.js, FastAPI (FE 버전은 `FE/package.json`에 고정, BE · AI는 TBD) | FE는 `FE/`에 Vite 템플릿으로 세팅하고 데모 코드를 제거함(패키지 매니저는 pnpm이고 버전은 `FE/package.json`의 `packageManager`로 고정. lint는 ESLint(typescript-eslint, jsx-a11y), 테스트는 Vitest + Testing Library + jsdom. TypeScript는 typescript-eslint가 7을 지원하지 않아 6.0으로 고정). BE · AI는 구현 전. 프레임워크 사용 |
| 외부 기술 | Tailwind CSS v4 (`@tailwindcss/vite`) | 스타일링 도구. 기본 팔레트를 비우고 흑백 토큰만 `@theme`에 선언. 컴포넌트 6종(Button · Input · Badge · Table · Card · LogBlock)은 직접 구현하고 기성 컴포넌트 키트는 쓰지 않음 |
| 외부 기술 | eslint-plugin-better-tailwindcss (FE devDependency, MIT) | 개발 도구. 린트에서 `theme.css`에 정의되지 않은 Tailwind 클래스(`bg-white` 등)를 막는다. 앱 번들에는 들어가지 않음. `no-unknown-classes`(없는 클래스)와 `no-restricted-classes`(임의값 · 로드하지 않은 굵기 · 그림자 계열) 두 규칙만 켰다 |
| 외부 기술 | Docker 이미지 `node:22-bookworm-slim` (빌드), `nginx:1.27-alpine` (정적 서빙) | `FE/Dockerfile`로 로컬 컨테이너 개발용 이미지를 만든다. 운영 배포는 S3 + CloudFront라 이 이미지는 쓰지 않는다. 이미지 빌드와 nginx 동작(SPA 경로, 캐시 헤더, gzip)은 2026-11-03에 로컬에서 확인했고, CI에서는 이미지를 빌드하지 않는다 |
| 외부 기술 | LangChain (배포 전 검토 파이프라인. 복잡해지면 LangGraph로 확장) | 구현 전. 체인 구성과 프롬프트는 직접 설계 |
| 외부 API | LLM API (업체·모델 미정) | 구현 전. 호출 하네스와 시스템 프롬프트는 직접 구현 |
| 외부 기술 | AWS — CodeBuild(빌드), S3 + CloudFront(웹 정적 파일), EC2(Nest · FastAPI · Kafka 브로커) | 구현 전. 설정·연동 |
| 외부 기술 | GHCR (학생 앱 이미지 레지스트리, 이미지 공개. [ADR-003](adr/003-registry-ghcr.md)) | 구현 전. 설정·연동 |
| 외부 기술 | Apache Kafka (EC2 단일 브로커) | 구현 전. 설정·연동 |
| 외부 기술 | Supabase (PostgreSQL, GitHub OAuth) | 구현 전. 설정·연동 |
| 외부 기술 | MySQL (학생 서비스 DB 애드온, PostgreSQL은 여유가 있을 때) | 구현 전. 프로젝트별 인스턴스 배치 · 접속 정보 주입은 직접 구현. 워커 장애는 학생 볼륨 사본(사본 2)이 견디고 클러스터 밖 백업은 후순위다. 사본은 백업이 아니다 ([시스템 정의서](system-definition.md) §5.2) |
| 외부 API | GitHub API — 봇 계정의 fork·PR 생성, OAuth 로그인 | 구현 전. 연동 |
| 외부 기술 | k3s (Traefik Ingress 포함), Prometheus (node-exporter · cAdvisor · kube-state-metrics · blackbox-exporter), Grafana | 구현 전. 설정·연동 |
| 외부 기술 | Tailscale (플랫폼 서버 ↔ 리더 연결, 운영자 원격 접속. [ADR-004](adr/004-server-cluster-link-tailscale.md)) | 구현 전. 설정·연동 |
| 외부 기술 | 로그 수집기 · 저장소 (제품 미정. 시계열 DB는 두지 않는다, [ADR-006](adr/006-metrics-on-leader-prometheus.md)) | 결정 전 |
| 외부 기술 | 취약점 스캐너 (후보: Trivy · OSV-Scanner) | 후보. 구현할 때 하나 고르고 확정되면 여기 올린다 |
| 외부 기술 | Cloudflare Tunnel (학생 서비스 공개 진입, 리더에서 실행) | 예정. 학교망이 터널 포트를 통과시키는지 현장에서 확인한 뒤 확정 |
| 외부 기술 | Longhorn (학생 볼륨 복제, 사본 2. 워커 메모리 125GiB 확인) | 예정. 설치 · 페일오버 시험 뒤 볼륨 ADR로 남긴다 |
| 외부 기술 | 레지스트리 캐시 (리더에서 실행, 제품은 구축 때 고른다) | 구현 전 |
| 외부 기술 | 클러스터 밖 백업 보관처 (학생 볼륨 백업 · 리더 상태 스냅샷, 후보 Cloudflare R2) | 후순위 |

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
- **리더가 단일 장애점이다.** 승격은 범위 밖이다. 터널이 리더에 있어 리더가 꺼지면 방문자도 들어오지 못한다(터널을 워커로 옮기는 것은 후순위). 스위치와 학교 와이파이도 단일 장애점이다. 정전 · 와이파이 끊김 · 디스크 가득 참이 흔한 실패 원인이다.
- **도메인은 11/11 연결을 목표로 한다.** 그 전에는 주소가 바뀔 수 있다. 연결 범위와 DNS 서비스 · 게이트웨이는 한계로 말한다.
- **클러스터 밖 백업(학생 볼륨, 리더 상태 스냅샷)은 후순위다.** 그것이 들어가기 전까지는 두 워커의 디스크가 함께 죽으면 학생 데이터를 잃고, 리더 디스크가 죽으면 클러스터를 다시 세워야 한다. 워커 하나가 죽으면 학생 볼륨 사본(사본 2)이 남은 워커에서 이어받지만, 사본은 백업이 아니라 지우거나 손상된 데이터는 되돌릴 수 없다.
