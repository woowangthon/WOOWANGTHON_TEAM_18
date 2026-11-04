# 인증 — 설계

- **상태**: 초안
- **관련**: SRS NFR-SEC-03 · [ADR-007](../adr/007-login-email-password-github-link.md) · [API 계약](api.md)의 인증 그룹

## 범위

- **한다**: Supabase Auth가 발급한 로그인 토큰(access token)을 플랫폼 서버가 검증하고, 요청마다 누가 불렀는지(`id`, `email`, `isAdmin`)를 정한다. 헬스 체크를 뺀 모든 API에 적용한다.
- **하지 않는다**: 로그인 · 가입 · 비밀번호 재설정 · 토큰 갱신. FE가 supabase-js로 Supabase에 직접 하고, 플랫폼 서버에는 로그인 API가 없다. 플랫폼 서버는 이 단계에서 Supabase 비밀키를 갖지 않는다.
- **예정**: GitHub 연동과 레포 소유 확인(아래 [GitHub 연동](#github-연동-예정)).

## 설계

1. FE가 이메일 · 비밀번호로 Supabase에 로그인해 access token(JWT, 기본 수명 1시간)과 refresh token을 받는다. 갱신은 supabase-js가 한다.
2. FE는 플랫폼 서버를 부를 때마다 `Authorization: Bearer <access token>`을 붙인다.
3. 플랫폼 서버의 전역 가드가 토큰을 검증한다.
   - 서명: Supabase의 공개 키 목록(JWKS, `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`)으로 확인한다. 공개 키는 처음 필요할 때 받아 두고, 모르는 `kid`가 오면 다시 받는다. 그래서 Supabase에서 키를 교체해도 재배포 없이 따라간다.
   - 알고리즘은 비대칭 키(`ES256` · `RS256`)만 받는다. 토큰이 스스로 적은 `alg`(`HS256`, `none`)를 믿지 않기 위해서다.
   - 발급자 `iss = <SUPABASE_URL>/auth/v1`, 대상 `aud = authenticated`, 만료 `exp`, 사용자 `sub`가 있어야 한다.
4. 통과하면 요청에 사용자 `{ id: sub, email, isAdmin }`을 붙인다. 컨트롤러는 `@CurrentUser()`로 읽고, 로그인 없이 열어 둘 라우트에는 `@Public()`을 붙인다.

### 관리자

`isAdmin`은 토큰의 `app_metadata.role === 'admin'`일 때만 참이다. `app_metadata`는 서버(관리자 키 · SQL)로만 바뀌고, `user_metadata`는 사용자가 `updateUser`로 직접 고칠 수 있어 권한 판단에 쓰지 않는다.

관리자 지정 절차:

1. Supabase 대시보드 Authentication → Users → **Add user**로 관리자 계정을 만든다 (Auto Confirm User를 켜면 이메일 확인을 건너뛴다).
2. SQL Editor에서 실행한다:
   ```sql
   update auth.users
   set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'
   where email = '<관리자 이메일>';
   ```
3. 토큰에는 발급 시점의 값이 들어가므로, 관리자는 다시 로그인하거나 토큰이 갱신된 뒤부터 관리자로 보인다. 해제도 같아서 기존 토큰이 만료될 때까지(최대 1시간) 남는다.

### 오류

모양은 SRS §2.4 공통 규칙(`{ "error": { "code", "message" } }`)을 따른다.

| 상황 | 응답 |
| --- | --- |
| `Authorization` 헤더가 없거나 `Bearer <토큰>` 형식이 아님 | `401 AUTH_REQUIRED` |
| 서명 · 알고리즘 · 발급자 · 대상 · 만료 · `sub` 중 하나라도 틀림 | `401 INVALID_TOKEN` |
| 공개 키를 받지 못함 (Supabase 장애 · 네트워크 · 시간 초과) | `503 AUTH_UNAVAILABLE` |

`503`을 따로 두는 이유: 인증 서버 쪽 장애를 "토큰이 틀렸다"(`401`)로 돌려주면 FE가 멀쩡한 사용자를 로그아웃시킨다. 그렇다고 검증 없이 통과시키지도 않는다([`conventions.md`](../conventions.md) F-1).

## GitHub 연동 (예정)

다음 PR에서 만든다. 정해 둔 것:

- 학생이 프로필에서 `supabase.auth.linkIdentity({ provider: 'github' })`로 연동한다. Supabase의 Manual linking 설정(beta)을 켜야 하고, GitHub OAuth 앱의 callback은 `<SUPABASE_URL>/auth/v1/callback`이다.
- 연동한 GitHub 계정은 토큰에 들어 있지 않다. 플랫폼 서버가 service role 키로 `auth.admin.getUserById(id)`를 불러 `identities` 중 `provider = 'github'`인 항목의 GitHub 사용자 ID를 읽고, 레포 소유자의 ID와 비교한다. 사용자명(login)은 바뀔 수 있어 숫자 ID로 비교한다.
- 다른 계정에 이미 연동된 GitHub 계정은 Supabase가 연동을 거부한다. 그래서 GitHub 계정 하나는 사용자 하나에만 붙는다.
- 연동 해제는 로그인 수단이 2개 이상일 때만 된다(이메일 + GitHub). 해제할 수 있으므로 소유 확인은 제출할 때마다 한다.

## 결정과 대안

| 결정 | 이유 | 버린 대안 |
| --- | --- | --- |
| 공개 키(JWKS)로 플랫폼 서버가 직접 검증한다 (jose) | 요청마다 Supabase를 부르지 않고, 플랫폼 서버에 비밀값이 필요 없다 | 요청마다 `supabase.auth.getUser(token)` 호출 — 요청마다 지연과 Supabase 의존이 생긴다. JWT secret(HS256) 공유 — Supabase에서 레거시이고 서버에 비밀값을 둔다 |
| 전역 가드 + `@Public()` 예외 | 새 라우트가 기본으로 보호된다 | 라우트마다 가드를 붙이기 — 빠뜨린 라우트는 그대로 열린다 |
| 관리자는 `app_metadata.role` | 사용자가 고칠 수 없고, 토큰 하나로 판단이 끝난다 | `user_metadata` — 사용자가 고칠 수 있다. 관리자 이메일을 환경 변수로 — 바꿀 때마다 재배포해야 하고 FE는 그 값을 모른다 |
| jose 하나로 구현 | JWKS 받기 · 캐시 · 검증을 다 하고, 가드는 몇십 줄이다 | `@nestjs/passport` + `passport-jwt` + `jwks-rsa` — 같은 일에 패키지 3개 |

## 알려진 한계

- 토큰은 수명(기본 1시간) 동안 유효하다. 로그아웃 · 계정 정지 · 관리자 해제가 플랫폼 서버에 바로 반영되지 않는다. 계정 정지 기능을 만들 때 DB 확인을 더할지 다시 본다.
- 자동 테스트는 테스트에서 만든 키로 서명한 토큰으로 검증 경로를 확인한다. 실제 Supabase 토큰은 테스트 계정으로 로그인해 직접(`curl`) 확인한다.
