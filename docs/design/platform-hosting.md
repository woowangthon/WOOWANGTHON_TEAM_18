# 플랫폼 FE · BE 배포 (AWS) — 설계

- **상태**: 초안 (2026-11-11)
- **관련**: SRS §2.6 · §7(BE HTTPS) · [ADR-001](../adr/001-stack-and-deployment.md) · [ADR-013](../adr/013-visitor-entry-cloudflare-tunnel.md) · [시스템 정의서 §3](../system-definition.md#3-시스템-개요)

## 범위

우리 플랫폼 자체(User Page · Admin Page와 플랫폼 서버)를 AWS에 올리는 방법이다. 학생 서비스 배포(GoCD 파이프라인, 클러스터)는 [배포 워크플로우](deploy-workflow.md)와 [클러스터](cluster.md)에 있다.

- **한다**:
  - FE를 S3 + CloudFront로 `https://app.stairnoworks.com`에 올린다.
  - BE를 EC2의 컨테이너로 띄우고, Cloudflare 프록시를 거쳐 `https://api.stairnoworks.com`으로 연다.
  - 설정값을 넣는 곳과, 다시 배포하는 명령을 정한다.
- **하지 않는다**: CI에서 자동 배포는 하지 않는다. 대회 기간에는 운영자가 스크립트를 손으로 돌린다. GoCD 서버 설치는 GoCD 담당이 한다(같은 EC2).

## 설계

```
브라우저 ──HTTPS──▶ CloudFront (app.) ──▶ S3 (FE 정적 파일)
   │
   └──HTTPS──▶ Cloudflare 프록시 (api.) ──HTTP :80──▶ EC2 ── 컨테이너 wcp-be (:3000)
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

### BE: EC2 + Cloudflare 프록시

| 항목 | 값 |
| --- | --- |
| 인스턴스 | `t3.large`(8GB, GoCD 서버와 같이 쓴다), Elastic IP. 대회가 끝나면 인스턴스 · Elastic IP · 디스크를 지운다 |
| 실행 | `BE/Dockerfile` 이미지를 컨테이너 `wcp-be`로, 재부팅 뒤에도 다시 뜨게(`--restart unless-stopped`). 호스트 80 → 컨테이너 3000 |
| HTTPS | Cloudflare에 `api` A 레코드 → Elastic IP, **프록시 켬**(주황 구름). 방문자 ↔ Cloudflare는 HTTPS, Cloudflare ↔ EC2는 HTTP 80. 이 호스트만 SSL 모드를 Flexible로 두는 Configuration Rule을 건다 |
| 보안 그룹 | 80은 [Cloudflare IP 대역](https://www.cloudflare.com/ips/)만. SSH는 운영자 IP만(또는 Tailscale). GoCD 포트는 인터넷에 열지 않는다(리더 실행기는 Tailscale로 붙는다, [클러스터 §8](cluster.md#8-플랫폼-서버와-배포-실행기의-권한-서버-계정-1차-구현됨-2026-11-10-나머지-예정)) |
| 설정값 | SSM Parameter Store `/wcp/be/<변수 이름>`(SecureString). 이름은 [`BE/.env.example`](../../BE/.env.example)과 같다. `CORS_ORIGINS=https://app.stairnoworks.com`. 값은 한 줄이어야 한다(여러 줄 값은 스크립트가 거절한다. PEM은 base64로). **필수 `/wcp/be/SECRET_HASH_KEY`**(비밀값 해시의 HMAC 키, 32자 이상, `openssl rand -hex 32`)가 없으면 BE가 부팅하지 않는다 |
| 권한 | 인스턴스 역할에 `/wcp/be` 경로의 `ssm:GetParametersByPath`와 `kms:Decrypt`만 |
| 올리기 | EC2에서 [`Infra/aws/deploy-be.sh`](../../Infra/aws/deploy-be.sh) `[git-ref]`. 새 컨테이너가 `/api/health`에 답하지 않으면 이전 컨테이너(이미지 · 설정 그대로)를 다시 띄운다 |

### 함께 바꿀 바깥 설정

- **Supabase** Authentication → URL Configuration: Site URL과 Redirect URLs에 `https://app.stairnoworks.com` 추가(이슈 #49).
- **GitHub OAuth 앱**: callback은 Supabase 주소라 바꿀 것이 없다.

## 결정과 대안

| 결정 | 이유 | 버린 대안 |
| --- | --- | --- |
| BE HTTPS는 Cloudflare 프록시(`api.`) | 도메인이 이미 Cloudflare에 있고, 인증서 발급 · 갱신이 필요 없다. 사용자 결정(2026-11-11) | EC2에 Caddy + Let's Encrypt(관리할 것이 늘어남), CloudFront 뒤에 `/api` 경로(같은 출처라 CORS는 없지만 캐시 규칙과 헤더 전달 설정이 더 많음) |
| Cloudflare ↔ EC2는 HTTP 80 + Flexible | 오늘 안에 열 수 있는 가장 짧은 길. 80은 Cloudflare IP만 받는다 | Full(strict) + Cloudflare Origin 인증서(구간 암호화. 마감 뒤 보완 후보) |
| 설정값은 SSM Parameter Store | 클러스터 담당이 값을 직접 넣고, 레포 · 채팅에 남지 않는다. 무료 | Secrets Manager(비밀당 월 요금), EC2에 손으로 `.env`(누가 무엇을 넣었는지 남지 않음) |
| 배포는 손으로 스크립트 | 마감까지 4일. CI에 AWS 권한을 주는 일(OIDC 역할)은 마감 뒤 | GitHub Actions 자동 배포 |

## 알려진 한계

- Cloudflare ↔ EC2 구간은 암호화되지 않는다(Flexible). 보안 그룹으로 Cloudflare만 받지만, 구간 자체는 평문이다.
- BE는 컨테이너 하나다. 배포하는 몇 초 동안 API가 응답하지 않는다.
- 스크립트는 실제 AWS에서 아직 돌려 보지 않았다(2026-11-11).
