# 플랫폼 FE · BE 배포 (AWS) — 설계

- **상태**: 초안 (2026-11-11)
- **관련**: SRS §2.6 · §7(BE HTTPS) · [ADR-001](../adr/001-stack-and-deployment.md) · [ADR-013](../adr/013-visitor-entry-cloudflare-tunnel.md) · [시스템 정의서 §3](../system-definition.md#3-시스템-개요)

## 범위

우리 플랫폼 자체(User Page · Admin Page와 플랫폼 서버)를 AWS에 올리는 방법이다. 학생 서비스 배포(GoCD 파이프라인, 클러스터)는 [배포 워크플로우](deploy-workflow.md)와 [클러스터](cluster.md)에 있다.

- **한다**:
  - FE를 S3 + CloudFront로 `https://app.stairnoworks.com`에 올린다.
  - BE를 EC2의 컨테이너로 띄우고, Cloudflare Tunnel로 `https://api.stairnoworks.com`에 연다.
  - 설정값을 넣는 곳과, 다시 배포하는 명령을 정한다.
- **하지 않는다**: CI에서 자동 배포는 하지 않는다. 대회 기간에는 운영자가 스크립트를 손으로 돌린다. GoCD 서버 설치는 GoCD 담당이 한다(같은 EC2).

## 설계

```
브라우저 ──HTTPS──▶ CloudFront (app.) ──▶ S3 (FE 정적 파일)
   │
   └──HTTPS──▶ Cloudflare (api.) ◀══터널(EC2가 밖으로 연 암호화 연결)══ EC2 ── wcp-tunnel ──▶ wcp-be (127.0.0.1:3000)
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
| 설정값 | SSM Parameter Store `/wcp/be/<변수 이름>`(SecureString). 이름은 [`BE/.env.example`](../../BE/.env.example)과 같다. `CORS_ORIGINS=https://app.stairnoworks.com`. 값은 한 줄이어야 한다(여러 줄 값은 스크립트가 거절한다. PEM은 base64로) |
| 권한 | 인스턴스 역할에 `/wcp/be` 경로의 `ssm:GetParametersByPath`, `/wcp/tunnel/TUNNEL_TOKEN`의 `ssm:GetParameter`, `kms:Decrypt`만 |
| 올리기 | EC2에서 [`Infra/aws/deploy-be.sh`](../../Infra/aws/deploy-be.sh) `[git-ref]`. 새 컨테이너가 `/api/health`에 답하지 않으면 이전 컨테이너(이미지 · 설정 그대로)를 다시 띄운다. 터널은 그대로 두고 BE만 바뀐다 |

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
- 스크립트는 실제 AWS에서 아직 돌려 보지 않았다(2026-11-11).
