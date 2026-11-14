# 플랫폼 FE · BE 배포 (AWS) — 설계

- **상태**: 초안 (2026-11-11)
- **관련**: SRS §2.6 · §7(BE HTTPS) · [ADR-001](../adr/001-stack-and-deployment.md) · [ADR-013](../adr/013-visitor-entry-cloudflare-tunnel.md) · [시스템 정의서 §3](../system-definition.md#3-시스템-개요)

## 범위

우리 플랫폼 자체(User Page · Admin Page와 플랫폼 서버)를 AWS에 올리는 방법이다. 학생 서비스 배포(GoCD 파이프라인, 클러스터)는 [배포 워크플로우](deploy-workflow.md)와 [클러스터](cluster.md)에 있다.

- **한다**:
  - FE를 S3 + CloudFront로 `https://app.stairnoworks.com`에 올린다.
  - BE를 EC2의 컨테이너로 띄우고, Cloudflare Tunnel로 `https://api.stairnoworks.com`에 연다.
  - AI 서버를 같은 EC2의 컨테이너로 띄운다(밖에 열지 않는다, 아래 "AI 서버").
  - 설정값을 넣는 곳과, 다시 배포하는 명령을 정한다.
- **하지 않는다**: CI에서 자동 배포는 하지 않는다. 대회 기간에는 운영자가 스크립트를 손으로 돌린다. GoCD 서버 · AWS 실행기는 아래 "GoCD 서버 · AWS 실행기"에 있다(같은 EC2).

## 설계

```
브라우저 ──HTTPS──▶ CloudFront (app.) ──▶ S3 (FE 정적 파일)
   │
   └──HTTPS──▶ Cloudflare (api.) ◀══터널(EC2가 밖으로 연 암호화 연결)══ EC2 ── wcp-tunnel ──▶ wcp-be (127.0.0.1:3000)
                                                                          ├── wcp-ai (127.0.0.1:8000) ◀─ docker 네트워크 wcp ─▶ wcp-be
                                                                          └── GoCD 서버 (사설망으로만)
```

### FE: S3 + CloudFront

| 항목 | 값 |
| --- | --- |
| S3 버킷 | 공개 접근 차단. CloudFront OAC로만 읽는다 |
| CloudFront | 기본 루트 객체 `index.html`. 403 · 404 응답을 `/index.html`(200)로 바꾼다(SPA 라우팅) |
| 인증서 | ACM **us-east-1**에서 `app.stairnoworks.com` 발급(DNS 검증 레코드를 Cloudflare에 추가) |
| DNS | Cloudflare에 `app` CNAME → CloudFront 도메인. **DNS만**(회색 구름). 프록시를 켜면 인증서가 두 겹이 된다 |
| 빌드 값 | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL=https://api.stairnoworks.com`. 번들에 그대로 박히므로 공개 값만 넣는다 |
| 올리기 | [`Infra/aws/deploy-fe.sh`](../../Infra/aws/deploy-fe.sh). 해시가 붙은 `assets/`는 오래 캐시하고 지우지 않으며, `index.html`은 캐시하지 않는다 |

`VITE_API_BASE_URL`은 FE가 BE를 부를 때 앞에 붙이는 주소다. FE 코드에서 이 값을 읽게 하는 변경은 FE 쪽 별도 PR이다. 그 전에는 FE가 `/api`를 상대 경로로 불러 BE에 닿지 않는다.

### BE: EC2 + Cloudflare Tunnel

| 항목 | 값 |
| --- | --- |
| 인스턴스 | `t3.large`(8GB, GoCD 서버와 같이 쓴다). 들어오는 연결이 없으므로 Elastic IP는 필요 없다. 대회가 끝나면 인스턴스 · 디스크를 지운다 |
| 실행 | `BE/Dockerfile` 이미지를 컨테이너 `wcp-be`로, 재부팅 뒤에도 다시 뜨게(`--restart unless-stopped`). 포트는 `127.0.0.1:3000`에만 연다 |
| HTTPS | 터널 클라이언트(cloudflared, 컨테이너 `wcp-tunnel`)가 EC2에서 Cloudflare로 암호화된 연결을 밖으로 연다. 방문자 ↔ Cloudflare는 HTTPS, Cloudflare ↔ EC2는 이 터널이라 평문 구간이 없다. 학생 서비스 입구(리더의 cloudflared, [ADR-013](../adr/013-visitor-entry-cloudflare-tunnel.md))와는 다른 터널이다 |
| 터널 만들기 | Cloudflare 대시보드 Zero Trust → Networks → Tunnels에서 터널을 만들고, Public Hostname `api.stairnoworks.com` → `http://localhost:3000`을 더한다. 이때 `api` CNAME이 자동으로 생긴다(같은 이름의 A 레코드가 있으면 먼저 지운다). 터널 토큰은 SSM `/wcp/tunnel/TUNNEL_TOKEN`(SecureString)에 넣는다. `/wcp/be` 밖이라 BE 설정에 섞이지 않는다 |
| 터널 띄우기 | EC2에서 [`Infra/aws/start-tunnel.sh`](../../Infra/aws/start-tunnel.sh)를 한 번 돌린다(토큰이나 cloudflared 버전을 바꿀 때 다시) |
| 보안 그룹 | 들어오는 규칙 없음. SSH는 Tailscale로 한다. GoCD 포트도 인터넷에 열지 않는다(리더 실행기는 Tailscale로 붙는다, [클러스터 §8](cluster.md#8-플랫폼-서버와-배포-실행기의-권한-서버-계정-1차-구현됨-2026-11-10-나머지-예정)) |
| 설정값 | SSM Parameter Store `/wcp/be/<변수 이름>`(SecureString). 이름은 [`BE/.env.example`](../../BE/.env.example)과 같다. `CORS_ORIGINS=https://app.stairnoworks.com`. 값은 한 줄이어야 한다(여러 줄 값은 스크립트가 거절한다. PEM은 base64로). **필수 `/wcp/be/SECRET_HASH_KEY`**(비밀값 해시의 HMAC 키, 32자 이상, `openssl rand -hex 32`)가 없으면 BE가 부팅하지 않는다 |
| 권한 | 인스턴스 역할에 `/wcp/be` 경로의 `ssm:GetParametersByPath`, `/wcp/tunnel/TUNNEL_TOKEN`의 `ssm:GetParameter`, `kms:Decrypt`만 |
| 올리기 | EC2에서 [`Infra/aws/deploy-be.sh`](../../Infra/aws/deploy-be.sh) `[git-ref]`. 새 컨테이너가 `/api/health`에 답하지 않으면 이전 컨테이너(이미지 · 설정 그대로)를 다시 띄운다. 터널은 그대로 두고 BE만 바뀐다 |
| 보안 검사 도구(UC-10) | BE 이미지에 gitleaks · trivy가 들어 있다(이미지 약 660MB, 도구 약 200MB). Trivy 취약점 DB는 이미지에 넣지 않는다: `deploy-be.sh`가 배포할 때마다 새 이미지의 trivy로 `~/.cache/wcp/trivy`에 받고(약 1.7GB, 로컬에서 약 37초) 컨테이너에 `/var/cache/trivy`로 읽기 전용으로 붙인다(`TRIVY_CACHE_DIR`). 받지 못하면 경고만 하고 가진 DB를 쓴다. 디스크 여유가 2GB 이상이어야 한다. 검사 하나는 로컬에서 1~3초, 컨테이너 최대 메모리 약 100MB였다 |

### GoCD 서버 · AWS 실행기

같은 EC2에 컨테이너 둘이 더 뜬다. 구성은 [`Infra/gocd/compose.yaml`](../../Infra/gocd/compose.yaml)이다.

```
EC2 ── gocd-server (GoCD 26.1.0, JVM -Xmx1g, 8153은 Tailscale 주소에만 연다)
   └── gocd-aws-agent (resource aws: Build 스테이지, CodeBuild 키가 있는 곳)
리더 Pod (Infra/executor/agent.yaml, resource leader) ──Tailscale──▶ gocd-server:8153
```

| 항목 | 값 |
| --- | --- |
| 파이프라인 정의 | [`Infra/gocd/student-deploy.gocd.yaml`](../../Infra/gocd/student-deploy.gocd.yaml). GoCD가 이 레포의 이 파일을 읽는다(설정 저장소). 파이프라인 `student-deploy`는 Build(aws) → Prepare → Render → Apply → Verify → Switch(leader)이고, commit이 올라와도 시작하지 않는다. 시작은 플랫폼 서버의 실행 요청뿐이다. Verify는 Traefik으로 동작 확인, Switch는 공개 주소 전환(open Ingress 적용과 남은 open Ingress · Middleware 정리)으로 CLI(#139)를 부른다. 이전 슬롯을 0개로 줄이는 일은 Switch가 하지 않고, 플랫폼 서버가 전환 성공 알림을 받아 `live_slot`을 바꾼 뒤 한다(W7). AI 에이전트의 시험은 같은 설정 저장소의 [`Infra/gocd/student-trial.gocd.yaml`](../../Infra/gocd/student-trial.gocd.yaml)(Build(aws) → Prepare → Render → Apply → Verify(leader), **Switch 없음**)이고, 게이트웨이가 `DEPLOY_ID` · `TRIAL_ID` · `TRIAL_STAGES`로 실행한다(api.md "파이프라인 ↔ 플랫폼 서버" 4번). `setup.sh`는 두 파이프라인이 모두 읽힐 때까지 기다린다 |
| 올리기 | EC2에서 [`Infra/aws/start-gocd.sh`](../../Infra/aws/start-gocd.sh). SSM의 값을 읽어 서버를 띄우고, [`Infra/gocd/setup.sh`](../../Infra/gocd/setup.sh)가 GoCD API로 로그인(파일 방식, 사용자 `admin`과 `be`) · 권한 나누기(시스템 관리자는 `admin`뿐, `be`는 파이프라인 그룹 `wcp`의 operate만) · 설정 저장소 등록 · BE가 쓸 접근 토큰 발급을 하고, AWS 실행기를 띄운다. 새 서버는 로그인이 꺼진 채 뜨므로 `setup.sh`가 끝날 때까지 127.0.0.1에만 열고, 그 뒤 같은 데이터로 Tailscale 주소에 다시 띄운다. 다시 돌려도 없는 것만 한다 |
| 설정값 | SSM `/wcp/gocd/<이름>`(SecureString, 한 줄): `ADMIN_PASSWORD`(16자 이상), `PIPELINE_NOTIFY_TOKEN`(BE의 같은 이름과 같은 값, 32자 이상), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`(아래 실행기 전용 IAM 사용자). `AWS_REGION=ap-northeast-2`는 공개 값이라 compose에 있다 |
| 인스턴스 역할 | 위 `/wcp/be` 권한에 `/wcp/gocd` 경로의 `ssm:GetParametersByPath`를 더한다(`kms:Decrypt`는 이미 있다). 컨테이너는 인스턴스 역할을 쓰지 못한다(IMDSv2 hop limit 1) |
| 비밀값이 가는 곳 | 파이프라인 파일에는 비밀값이 없다. 알림 토큰과 AWS 키는 실행기 컨테이너의 환경변수다(AWS 실행기는 compose, 리더 실행기는 Secret `gocd-agent`). GoCD는 설정 저장소의 파이프라인에 비밀 변수를 붙일 수 없고(서버 설정의 환경은 그 파이프라인을 가리킬 수 없다) 비밀 관리 플러그인은 서버에 들어 있지 않아서다. 로그에 값이 찍히지 않는 것은 도구가 찍지 않기 때문이다 |
| 접근 토큰 | `setup.sh`가 사용자 `be`로 발급해 `~/.config/wcp/gocd/be-gocd-token`(0600)에 한 번 쓴다. 운영자가 그 값을 SSM `/wcp/be/GOCD_TOKEN`에 넣는다. GoCD는 토큰을 만들 때 한 번만 보여 주므로 파일을 지우면 새로 발급해야 한다. **`be`는 관리자가 아니다**: 실행(schedule) · 스테이지 취소 · 읽기만 되고, 설정 저장소 등록 · 파이프라인 수정 · 관리자 지정은 403이다(실제 GoCD 26.1.0에서 확인). 토큰으로 설정 저장소를 등록하면 AWS 실행기에서 명령을 돌려 AWS 키를 꺼낼 수 있어서(아래 "왜 CodeBuild를 시작할 수 있는 키가 이 컨테이너에만 있나"와 같은 이유) 나눴다. `be`의 비밀번호는 `setup.sh`가 실행마다 새로 만들고 저장하지 않는다(토큰을 만들 때만 쓴다) |
| 리더 실행기 | `setup.sh`가 `~/.config/wcp/gocd/leader-agent.env`(서버 주소, 등록 키, 알림 토큰)를 쓴다. 등록 키와 알림 토큰은 SSM `/wcp/gocd/AGENT_AUTO_REGISTER_KEY` · `/wcp/gocd/PIPELINE_NOTIFY_TOKEN`에도 있다. 운영자가 그 파일이나 SSM에서 값을 화면에 찍지 않고 리더의 Secret `gocd-agent`(키 셋)를 만든 뒤 `Infra/executor/agent.yaml`을 적용한다(그 파일 머리말). 이 Secret이 없으면 Pod는 `CreateContainerConfigError`로 서 있다 |

**BE 설정에 더할 값** (SSM `/wcp/be/<이름>`, 이름은 [`BE/.env.example`](../../BE/.env.example)과 같다):

| 이름 | 값 |
| --- | --- |
| `GOCD_URL` | `http://<EC2의 Tailscale 주소>:8153`(끝에 `/` 없이) |
| `GOCD_TOKEN` | `setup.sh`가 사용자 `be`로 만든 접근 토큰(operate만) |
| `GOCD_PIPELINE` | `student-deploy` |
| `GOCD_TRIAL_PIPELINE` | `student-trial`(AI 에이전트의 시험. 비워 두면 게이트웨이의 `run_*` 도구가 실패한다) |
| `PIPELINE_NOTIFY_TOKEN` | 위 `/wcp/gocd/PIPELINE_NOTIFY_TOKEN`과 같은 값 |
| `CLUSTER_FULL_PERCENT` | 선택(1–100, 없으면 80). 워커 노드의 CPU · 메모리 사용률 중 큰 값이 이 값 이상이면 새 배포를 거절하고(`409 CLUSTER_FULL`) 대기 중인 배포는 출발하지 않는다 |

**콘솔에서 만들 AWS 리소스** (서울 `ap-northeast-2`, 이름은 파이프라인이 그대로 쓴다):

| 리소스 | 설정 |
| --- | --- |
| CodeBuild 프로젝트 `student-apps` | 소스 없음(NO_SOURCE). 환경: 관리형 이미지 `aws/codebuild/amazonlinux-x86_64-standard:5.0`(Amazon Linux), `LINUX_CONTAINER`, **권한 있는 모드(privileged) 켬**(`docker build`), 컴퓨팅 **`BUILD_GENERAL1_SMALL`**(무료 티어가 적용되는 크기. AI 시험 빌드도 SMALL만 쓴다, `BE/src/gateway/tools.ts`). **VPC 밖**. 시간 제한 **15분**(파이프라인이 대기 상한을 이것에 맞춘다, `build.ts`의 `MAX_WAIT_MS`), 대기열 제한 10분, 캐시 없음. 프로젝트에 저장된 buildspec은 `Infra/build/buildspec.yml`과 같은 내용(주석만 없음)이지만, StartBuild가 매번 `buildspecOverride`로 넘기므로 저장된 값은 쓰이지 않는다. 로그 그룹 `/aws/codebuild/student-apps`. 위 값은 2026-11-14 `aws codebuild batch-get-projects`로 확인했다. 콘솔에서 만든 프로젝트라 다른 계정으로 옮기면 이 값대로 다시 만든다 |
| 위 프로젝트의 서비스 역할 | CloudWatch Logs 쓰기와 `secretsmanager:GetSecretValue`(비밀 `wcp/codebuild/GHCR_TOKEN` 하나만). 그 밖의 권한은 없다 |
| Secrets Manager 비밀 `wcp/codebuild/GHCR_TOKEN` | 평문(JSON 아님). 값은 봇 GitHub 계정의 토큰(classic, `write:packages`). 파이프라인의 `GHCR_TOKEN_SECRET_ID`에 이 이름이 들어 있다 |
| IAM 사용자 `wcp-gocd-aws-agent` (AWS 실행기 전용) | `codebuild:StartBuild` · `codebuild:BatchGetBuilds`는 프로젝트 `student-apps`에만, `logs:GetLogEvents`는 그 로그 그룹(`/aws/codebuild/student-apps:log-stream:*`)에만. 콘솔 로그인은 없고 액세스 키만 만들어 SSM `/wcp/gocd/AWS_ACCESS_KEY_ID` · `AWS_SECRET_ACCESS_KEY`에 넣는다 |
| 봇 GitHub 계정과 패키지 | 학생 이미지는 `ghcr.io/<봇 계정>/student-apps` 하나다([배포 인계](deploy-handoff.md)). 첫 push 뒤 GHCR에서 이 패키지를 **Public**으로 바꾼다(새 패키지는 비공개라 워커가 토큰 없이 받지 못한다, [ADR-003](../adr/003-registry-ghcr.md)). 봇 계정은 `wanggane-bot`이고, 파이프라인 파일의 `GHCR_USER` · `IMAGE_REPO`에 들어 있다. |

**왜 CodeBuild를 시작할 수 있는 키가 이 컨테이너에만 있나**: CodeBuild를 시작할 수 있으면 빌드 명령을 바꿔 GHCR 토큰을 꺼내 갈 수 있어서다([배포 워크플로우](deploy-workflow.md) §8). 그래서 키는 실행기 전용 IAM 사용자의 것이고, 인스턴스 역할에는 CodeBuild 권한이 없다.

### AI 서버

같은 EC2에 컨테이너 `wcp-ai`가 하나 더 뜬다. BE와 AI 서버는 서로를 부른다: BE가 문제 티켓 · 종료 알림을 AI 서버로(`AI_SERVER_URL`), AI 에이전트가 MCP 게이트웨이를 BE로(`GATEWAY_URL`) 보낸다([API 계약](api.md) "AI 에이전트"). 컨테이너는 서로의 `127.0.0.1`에 닿지 않으므로, 둘을 사용자 정의 docker 네트워크 `wcp`에 두고 컨테이너 이름으로 부른다.

| 항목 | 값 |
| --- | --- |
| 실행 | `AI/Dockerfile` 이미지를 컨테이너 `wcp-ai`로, `--restart unless-stopped`, 네트워크 `wcp`. 포트 `8000`은 `127.0.0.1`에만 연다(배포 스크립트의 헬스 확인용). 터널에는 붙이지 않는다: 밖에서 AI 서버에 닿을 길은 없다 |
| 네트워크 | docker 네트워크 `wcp`(없으면 `deploy-be.sh` · `deploy-ai.sh`가 만든다). `wcp-be`도 이 네트워크에 붙는다. 게이트웨이 포트(`GATEWAY_PORT`)는 BE 컨테이너 밖으로 열지 않고, 같은 네트워크의 `wcp-ai`만 닿는다 |
| 설정값 | SSM `/wcp/ai/<이름>`(SecureString, 한 줄). 이름은 [`AI/.env.example`](../../AI/.env.example)과 같다. **필수**: `AGENT_API_TOKEN`(32자 이상, `openssl rand -hex 32`), `GATEWAY_URL=http://wcp-be:<GATEWAY_PORT>/mcp`. 선택: `LOCAL_MODEL_URL` · `LOCAL_MODEL_NAME` · `LOCAL_MODEL_API_KEY`, `PLANNER_MODEL_URL` · `PLANNER_MODEL_NAME` · `PLANNER_MODEL_API_KEY`, `AGENT_MAX_RUNS`. `HOST` · `PORT`는 넣지 않는다(이미지가 `0.0.0.0`, 스크립트가 `8000`으로 둔다). 모델 값이 없으면 서버는 뜨고 티켓마다 "AI 모델 설정이 없어 문제 해결을 하지 않았습니다" `gave_up`을 낸다(지금은 모델 없이 올린다) |
| BE 쪽 값 | SSM `/wcp/be`에 `AI_SERVER_URL=http://wcp-ai:8000`, `AGENT_API_TOKEN`(위 `/wcp/ai/AGENT_API_TOKEN`과 **같은 값**), `GATEWAY_PORT`(`3000`이 아닌 포트, 예 `3100`)를 넣는다 |
| 권한 | 인스턴스 역할에 `/wcp/ai` 경로의 `ssm:GetParametersByPath`를 더한다(`kms:Decrypt`는 이미 있다) |
| 올리기 | 처음 한 번은 `deploy-be.sh`를 먼저(네트워크 `wcp`가 생기고 `wcp-be`가 그 네트워크에 붙는다, 위 BE 쪽 값도 이때 들어간다), 그다음 [`Infra/aws/deploy-ai.sh`](../../Infra/aws/deploy-ai.sh) `[git-ref]`. 새 컨테이너가 `/health`에 답하지 않으면 이전 컨테이너(이미지 · 설정 그대로)를 다시 띄운다. 앞선 실행이 중간에 멈춰 멈춘 `wcp-ai-prev`만 남았으면, 설정을 읽기 전에 그것을 `wcp-ai`로 되살린다. 한 번에 하나만 돈다(`flock`, util-linux. Amazon Linux 2023에는 기본으로 있다, `command -v flock`으로 확인). 그 뒤로는 바뀐 쪽만 다시 돌린다 |

### 함께 바꿀 바깥 설정

- **Supabase** Authentication → URL Configuration: Site URL과 Redirect URLs에 `https://app.stairnoworks.com` 추가(이슈 #49).
- **GitHub OAuth 앱**: callback은 Supabase 주소라 바꿀 것이 없다.

## 결정과 대안

| 결정 | 이유 | 버린 대안 |
| --- | --- | --- |
| BE HTTPS는 Cloudflare Tunnel(`api.`) | 도메인이 이미 Cloudflare에 있고 인증서 발급 · 갱신이 필요 없다. Cloudflare ↔ EC2 구간도 암호화되고, EC2에 들어오는 포트를 하나도 열지 않는다. 학생 서비스 입구와 같은 도구라 새로 익힐 것이 적다. 사용자 결정(2026-11-11, #105 리뷰 뒤) | Cloudflare 프록시 + Flexible(#105의 첫 안. Cloudflare ↔ EC2가 평문이라 로그인 토큰이 그대로 지나간다), 프록시 + Full(strict) + Origin 인증서(EC2에 TLS 종단이 하나 더 필요), EC2에 Caddy + Let's Encrypt(관리할 것이 늘어남), CloudFront 뒤에 `/api` 경로(캐시 규칙과 헤더 전달 설정이 더 많음) |
| 터널은 대시보드에서 만들고 토큰으로 띄운다 | 공개 이름이 `api.` 하나라 설정이 짧다. EC2에는 토큰 하나만 있으면 된다 | 리더처럼 자격 증명 파일 + 레포의 설정 파일(파일을 EC2로 옮기는 단계가 는다), 리더의 기존 터널에 `api.` 규칙 추가(플랫폼 API가 학교 클러스터와 리더의 인터넷 길에 묶이고, 리더 cloudflared의 NetworkPolicy가 Tailscale 대역을 막는다) |
| 설정값은 SSM Parameter Store | 클러스터 담당이 값을 직접 넣고, 레포 · 채팅에 남지 않는다. 무료 | Secrets Manager(비밀당 월 요금), EC2에 손으로 `.env`(누가 무엇을 넣었는지 남지 않음) |
| 배포는 손으로 스크립트 | 마감까지 4일. CI에 AWS 권한을 주는 일(OIDC 역할)은 마감 뒤 | GitHub Actions 자동 배포 |

## 알려진 한계

- BE는 컨테이너 하나다. 배포하는 몇 초 동안 API가 응답하지 않는다.
- AI 서버도 컨테이너 하나다. 다시 배포하는 동안 도는 에이전트 실행은 끊긴다(그 티켓은 결과 없이 시간 초과로 끝난다). `deploy-ai.sh`와 `wcp` 네트워크는 로컬 docker로만 확인했다(2026-11-13, 가짜 설정값): 두 컨테이너가 같은 네트워크에 뜨고, AI → `http://wcp-be:<GATEWAY_PORT>/mcp`, BE → `http://wcp-ai:8000/health`가 닿고, 게이트웨이 포트는 호스트에 열리지 않으며, 잘못된 설정이면 이전 컨테이너로 되돌아간다. 실제 EC2에서는 돌려 보지 않았다.
- `deploy-be.sh`에는 아직 동시 실행 잠금이 없고, 중간에 멈춘 `wcp-be-prev`를 되살리는 일도 빌드 뒤에 하며 rename만 한다(`deploy-ai.sh`는 CodeRabbit 리뷰를 받아 고쳤다). BE 배포에 주는 영향을 줄이려고 이번에는 네트워크 줄만 바꿨다. 후속에서 같은 모양으로 맞춘다.
- 스크립트는 실제 AWS에서 아직 돌려 보지 않았다(2026-11-11). `start-gocd.sh`와 AWS 실행기도 EC2에서는 돌려 보지 않았다(로컬 docker에서 서버 기동 · 로그인 · 설정 저장소 등록 · 접근 토큰 발급까지만 확인했다).
- GoCD 서버와 AWS 실행기가 죽으면 새 배포가 시작되지 않는다(BE가 `503 PIPELINE_UNAVAILABLE`). (`setup`이나 artifact 받기가 실패한 job은 `job.sh`가 `STAGE_NO_REPORT`를 curl로 알린다.) 실행 중이던 job이 GoCD의 시간 제한이나 실행기가 죽어서 끝나면 알림을 보내는 task가 돌지 못해 그 배포는 `running`으로 남는다. 같은 프로젝트의 다음 시작이 그 기록을 시간 초과(`TIMED_OUT`)로 마감하지만(BE의 `STALE_RUN_MS`, 1시간), 그 전까지 학생에게는 진행 중으로 보인다.
- BE 컨테이너가 Tailscale 주소의 8153에 닿는지(`GOCD_URL`)는 EC2에서 확인하지 않았다.
- 보안 검사의 Trivy DB는 배포할 때만 새로 받는다. BE를 오래 다시 배포하지 않으면 새로 알려진 취약점이 늦게 잡힌다. 배포 중 DB를 받는 동안 이전 컨테이너가 검사를 돌리면 그 검사는 실패할 수 있다(`SCAN_FAILED`, 다음 저장 때 다시 검사).
