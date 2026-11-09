# 인증 — 설계

- **상태**: 구현됨 (로그인 토큰 검증, 레포 소유 확인, FE의 연동 버튼 — 프로필 화면)
- **관련**: SRS NFR-SEC-03 · NFR-SEC-04 · [ADR-007](../adr/007-login-email-password-github-link.md) · [API 계약](api.md)의 인증 그룹

## 범위

- **한다**: Supabase Auth가 발급한 로그인 토큰(access token)을 플랫폼 서버가 검증하고, 요청마다 누가 불렀는지(`id`, `email`, `isAdmin`)를 정한다. 로그인 없이 열기로 정한 API(헬스 체크, 나중에 만들 Playground 공개 조회 — [시스템 정의서](../system-definition.md) §4.4)를 뺀 모든 API에 적용한다.
- **하지 않는다**: 로그인 · 가입 · 비밀번호 재설정 · 토큰 갱신. FE가 supabase-js로 Supabase에 직접 하고, 플랫폼 서버에는 로그인 API가 없다. 플랫폼 서버는 이 단계에서 Supabase 비밀키를 갖지 않는다.
- **GitHub 연동과 레포 소유 확인**: 아래 [GitHub 연동과 레포 소유 확인](#github-연동과-레포-소유-확인).

## 설계

1. FE가 이메일 · 비밀번호로 Supabase에 로그인해 access token(JWT, 기본 수명 1시간)과 refresh token을 받는다. 갱신은 supabase-js가 한다.
2. FE는 플랫폼 서버를 부를 때마다 `Authorization: Bearer <access token>`을 붙인다.
   - 서버가 `401 AUTH_REQUIRED` · `401 INVALID_TOKEN`을 주면 FE는 `refreshSession()`으로 한 번 갱신해 같은 요청을 다시 보낸다. 그래도 401이거나 갱신이 거부되면 **이 기기만** 로그아웃(`signOut({ scope: 'local' })`)하고 로그인 화면(X1)으로 보낸다. 갱신이 오프라인 · 서버 장애로 안 된 경우와 `503`은 로그아웃하지 않는다.
   - 세션 연장 버튼은 두지 않는다. 갱신은 supabase-js가 자동으로 한다.
3. 플랫폼 서버의 전역 가드가 토큰을 검증한다.
   - 서명: Supabase의 공개 키 목록(JWKS, `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`)으로 확인한다. 공개 키는 처음 필요할 때 받아 두고, 모르는 `kid`가 오면 다시 받는다. 그래서 Supabase에서 키를 교체해도 재배포 없이 따라간다. 키를 받는 주소라 `SUPABASE_URL`은 `https`여야 한다(평문이면 중간에서 키를 바꿔 위조 토큰을 통과시킬 수 있다. 로컬 Supabase용 loopback 주소만 `http`를 허용한다).
   - 알고리즘 허용 목록은 따로 두지 않는다. jose는 토큰의 `alg`에 맞는 종류의 키만 키 목록에서 고르는데, 공개 키 목록에는 HMAC 키가 있을 수 없고 `alg: none`은 항상 거부한다. 그래서 `alg`를 `HS256` · `none`으로 바꾼 토큰은 통과하지 못한다(자동 테스트). 목록을 따로 두어도 결과가 같다는 것을 뮤턴트로 확인했다.
   - 발급자 `iss = <SUPABASE_URL>/auth/v1`, 대상 `aud = authenticated`, 만료 `exp`가 지나지 않아야 하고 `sub` · `email` · `exp`가 있어야 한다. jose는 `exp`가 없으면 만료를 보지 않으므로 `exp`도 필수로 둔다.
   - 공개 키를 받지 못하는 경우는 jose 오류 종류로 가린다: 응답이 200이 아니거나 JSON이 아님(`JOSEError` 자체), 시간 초과(`JWKSTimeout`, 기본 5초), 키 목록 형식 오류(`JWKSInvalid`), 네트워크 오류(JOSE 오류가 아닌 `TypeError`). 이 네 경우가 `503`이고, 나머지 JOSE 오류는 토큰 문제라 `401`이다.
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
| 서명 · 알고리즘 · 발급자 · 대상 · 만료가 틀리거나 `sub` · `email` · `exp`가 없음 (이메일 없는 전화번호 · 익명 로그인 토큰도 여기 해당. 우리는 이메일 로그인만 쓴다) | `401 INVALID_TOKEN` |
| 공개 키를 받지 못함 (Supabase 장애 · 네트워크 · 시간 초과) | `503 AUTH_UNAVAILABLE` |

`503`을 따로 두는 이유: 인증 서버 쪽 장애를 "토큰이 틀렸다"(`401`)로 돌려주면 FE가 멀쩡한 사용자를 로그아웃시킨다. 그렇다고 검증 없이 통과시키지도 않는다([`conventions.md`](../conventions.md) F-1).

## GitHub 연동과 레포 소유 확인

연동은 FE가, 확인은 플랫폼 서버가 한다. 확인 API는 [`api.md`](api.md)의 `POST /api/repos/check`이고, 나중에 만들 제출 API가 같은 확인을 그대로 쓴다.

- 학생이 프로필에서 `supabase.auth.linkIdentity({ provider: 'github' })`로 연동한다. Supabase의 Manual linking 설정(beta)을 켜야 하고, GitHub OAuth 앱의 callback은 `<SUPABASE_URL>/auth/v1/callback`이다. 요청하는 권한은 읽기뿐이다.
- 연동한 GitHub 계정은 토큰에 들어 있지 않다. 플랫폼 서버는 **요청에 온 사용자 토큰 그대로** `GET <SUPABASE_URL>/auth/v1/user`(헤더 `Authorization: Bearer <토큰>` · `apikey: <공개 키>`)를 불러, 돌려받은 `identities` 중 `provider = 'github'`인 항목의 `id`(GitHub 사용자 숫자 ID)를 읽는다. 사용자명(login)은 바뀔 수 있어 숫자 ID로 비교한다. 이 방법이라 플랫폼 서버에 Supabase 비밀키(service role)가 필요 없고, 로그아웃되었거나 폐기된 세션의 토큰은 Supabase가 거부한다. 서버에 두는 값은 공개 키(`SUPABASE_PUBLISHABLE_KEY`, FE 번들에도 들어가는 값)뿐이다.
- 사용자 토큰은 Supabase에만 보낸다. GitHub에는 어떤 `Authorization`도 붙이지 않고 공개 레포 조회만 한다.
- 다른 계정에 이미 연동된 GitHub 계정은 Supabase가 연동을 거부한다. 그래서 GitHub 계정 하나는 사용자 하나에만 붙는다.
- 연동 해제는 로그인 수단이 2개 이상일 때만 된다(이메일 + GitHub). 해제할 수 있으므로 소유 확인은 요청할 때마다 한다(저장해 두지 않는다).

### 확인 순서와 오류

앞 단계에서 실패하면 뒤 단계는 하지 않는다. 오류 모양은 SRS §2.4 공통 규칙을 따른다.

| 단계 | 실패 | 응답 |
| --- | --- | --- |
| 1. 레포 주소 읽기: `https://github.com/<소유자>/<레포>`(끝의 `.git` · `/`는 허용)만 받는다 | 다른 호스트 · `http` · 사용자 정보 · 추가 경로 · 빈 이름 | `400 INVALID_REPO_URL` |
| 2. Supabase에서 사용자 조회 | Supabase가 토큰을 거부(`403`) | `401 INVALID_TOKEN` |
| | Supabase가 `401`(우리 공개 키가 틀렸거나 교체됨) · 장애 · 네트워크 · 시간 초과 | `503 AUTH_UNAVAILABLE` (로그를 남긴다) |
| 3. 연동한 GitHub 확인 | `github` identity가 없음 | `403 GITHUB_NOT_LINKED` |
| 4. GitHub에서 레포 조회 | 없는 레포, 비공개 레포(GitHub는 둘 다 `404`로 답한다) | `404 REPO_NOT_FOUND` |
| | 한도 초과(`403` · `429`) · GitHub 장애 · 네트워크 · 시간 초과 | `503 GITHUB_UNAVAILABLE` |
| 5. 개인 레포인가 | 소유자가 조직(`type`이 `User`가 아님). MVP는 공개 개인 레포만 지원한다([ADR-002](../adr/002-bot-account-for-fix-prs.md)) | `422 REPO_NOT_PERSONAL` |
| 6. 소유자 대조 | 소유자 ID ≠ 연동한 GitHub ID | `403 REPO_NOT_OWNED` |

Supabase `GET /auth/v1/user`의 `401`과 `403`은 책임이 다르다(2026-11-09 실제 응답으로 확인). 틀린 `apikey`는 `401 Invalid API key`, `apikey` 없음은 `401 No API key found in request`(둘 다 `error_code` 없음)이고, 위조 토큰은 `403 bad_jwt`, 로그아웃된 세션은 `403 session_not_found`다. 사용자 쪽 토큰 문제는 모두 `403`이고 `401`은 우리 쪽 설정 문제이므로, `401`을 `INVALID_TOKEN`으로 돌려주면 공개 키가 틀렸을 때 모든 사용자가 "토큰이 틀렸다"를 받고 원인이 로그에 남지 않는다.

`POST /api/repos/check`는 위 1~6단계를 통과한 **뒤에** 접수할 commit을 확정한다(소유 오류는 이 호출에 닿지 않는다). `GET /repos/{소유자}/{레포}/commits/HEAD`를 `Accept: application/vnd.github.sha`로 인증 없이 부르면 40자 SHA만 텍스트로 온다(JSON 응답은 4.7KB이고 commit이 바꾼 파일 목록까지 실려 와 크기가 커질 수 있어 쓰지 않는다. 2026-11-10 실제 공개 레포로 확인). 커밋이 없는 빈 레포는 `409`로 답할 것으로 보고 `commit: null`과 `200`을 돌려준다(이 호출의 `409`는 빈 공개 레포가 없어 직접 확인하지 못했다. 파일 목록의 `409`는 위 7단계처럼 확인했다). 그 밖에 SHA를 못 읽으면 `503 GITHUB_UNAVAILABLE`이다. 한 요청에 GitHub를 두 번 부른다(레포 조회 + commit).

`POST /api/repos/dockerfiles`는 위 1~6단계를 그대로 거친 뒤에야 7단계로 간다. 7단계는 파일 목록을 한 번 더 받는다(`GET /repos/{소유자}/{레포}/git/trees/HEAD?recursive=1`, 인증 없이. `HEAD`는 기본 브랜치다). 커밋이 없는 빈 레포는 GitHub가 `409 Git Repository is empty.`로 답하는데(2026-11-09 실제 공개 빈 레포로 확인), 파일이 없는 정상 상태이므로 빈 목록과 `200`을 돌려준다. 그 밖에 목록을 못 받으면(없음 · 한도 · 장애 · 네트워크 · 시간 초과) `503 GITHUB_UNAVAILABLE`이다. 소유 확인을 이미 통과했으므로 `404`를 `REPO_NOT_FOUND`로 돌려주지 않는다. 한 요청에 GitHub를 두 번 부른다(레포 조회 + 파일 목록).

`POST /api/repos/deploy-spec`는 1~6단계를 그대로 거친 뒤 7단계(파일 목록), 8단계(파일 내용)로 간다. 요청에 `commit`이 있으면 6단계와 7단계 사이에 그 SHA가 이 레포의 commit인지 확인한다. `git/trees`는 commit이 아닌 tree SHA도 받는데 그 SHA로는 raw 파일이 `404`라, 그대로 두면 모든 `package.json`이 조용히 "읽을 수 없음"이 되기 때문이다. `GET /repos/{소유자}/{레포}/commits/{sha}`(위와 같은 `Accept`)가 `200`이면 commit이다. 없는 SHA · tree SHA · 다른 레포의 SHA는 모두 `422`(2026-11-10 실제 응답)이고, 이를 `404 COMMIT_NOT_FOUND`로 돌려준다(`409`도 같다. 커밋이 없는 레포에는 commit이 없다). 그 밖의 실패는 `503 GITHUB_UNAVAILABLE`이다. 이어서 7단계 파일 목록은 `git/trees/{sha}?recursive=1`로 받는다(`commit`이 없으면 위 7단계와 같이 `HEAD`). 8단계는 7단계 파일 목록에서 고른 `package.json`(최대 10개)의 내용을 `https://raw.githubusercontent.com/{소유자}/{레포}/{commit 또는 HEAD}/{경로}`로 **인증 없이 병렬로** 읽는다(사용자 토큰은 보내지 않고, 경로는 세그먼트마다 인코딩한다). 락 파일은 7단계 목록의 이름만 보고 내용은 읽지 않는다. 읽지 못하면(한도 · 장애 · 네트워크 · 시간 초과) `503 GITHUB_UNAVAILABLE`이고, 읽는 사이 파일이 사라져 `404`가 나면 그 폴더만 판단 필요로 둔다. GitHub API 호출은 `commit`이 없으면 두 번(레포 조회 + 파일 목록), 있으면 세 번(레포 조회 + commit 확인 + 파일 목록)이다.

외부 서비스 장애는 사용자 잘못(`4xx`)으로 바꾸지 않고 `503`으로 돌려준다([`conventions.md`](../conventions.md) F-1). 내가 소유자인 레포를 다른 레포에서 fork한 경우도 소유자는 나이므로 통과한다. 관리자도 같은 확인을 받는다(관리자는 제출하지 않고 보기만 하므로 예외를 두지 않는다).

## 결정과 대안

| 결정 | 이유 | 버린 대안 |
| --- | --- | --- |
| 공개 키(JWKS)로 플랫폼 서버가 직접 검증한다 (jose) | 요청마다 Supabase를 부르지 않고, 플랫폼 서버에 비밀값이 필요 없다 | 요청마다 `supabase.auth.getUser(token)` 호출 — 요청마다 지연과 Supabase 의존이 생긴다. JWT secret(HS256) 공유 — Supabase에서 레거시이고 서버에 비밀값을 둔다 |
| 전역 가드 + `@Public()` 예외 | 새 라우트가 기본으로 보호된다 | 라우트마다 가드를 붙이기 — 빠뜨린 라우트는 그대로 열린다 |
| 관리자는 `app_metadata.role` | 사용자가 고칠 수 없고, 토큰 하나로 판단이 끝난다 | `user_metadata` — 사용자가 고칠 수 있다. 관리자 이메일을 환경 변수로 — 바꿀 때마다 재배포해야 하고 FE는 그 값을 모른다 |
| jose 하나로 구현 | JWKS 받기 · 캐시 · 검증을 다 하고, 가드는 몇십 줄이다 | `@nestjs/passport` + `passport-jwt` + `jwks-rsa` — 같은 일에 패키지 3개 |

## 알려진 한계

- GitHub 공개 API를 인증 없이 부르면 서버 IP당 시간당 60번까지다. 소유 확인(`repos/check`)은 두 번(레포 조회 + commit), Dockerfile 확인은 두 번, 배포 설정 초안은 `commit`을 주면 세 번이라, 사용자 한 명이 제출 한 번에 일곱 번을 쓴다(서버 IP당 시간당 약 8건). 여러 사용자가 같은 서버 IP를 쓰므로 데모 인원이 많으면 모자랄 수 있다. 데모 전에 봇 계정(ADR-002)의 토큰(5000번까지) 또는 결과 캐시로 다시 본다(구현은 아직 없다). 한도에 걸리면 `503 GITHUB_UNAVAILABLE`이다.
- 배포 설정 초안(`deploy-spec`)의 `package.json` 읽기는 `raw.githubusercontent.com`을 쓴다. 이 주소의 응답에는 한도 헤더가 없고 API 한도(`core`)가 줄지 않는 것을 2026-11-09에 직접 확인했다. 다만 이 주소에도 따로 정해지지 않은 한도가 있을 수 있고 응답이 5분 캐시된다(`cache-control: max-age=300`). 그래서 방금 push한 변경이 초안에 늦게 보일 수 있다. `commit`을 주지 않아 `HEAD`를 읽으면 파일 목록과 내용을 서로 다른 시점에 읽게 되어 그 사이 push가 있으면 어긋날 수 있다. `commit`을 주면 SHA 경로는 바뀌지 않으므로 어긋남도 5분 캐시 문제도 없다([#41](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/41) · [#60](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/60)).
- `commit`은 클라이언트가 보낸 값이라 아직 서버가 믿을 SHA가 아니다. 지금은 읽기 전용 초안에만 쓰이고 공개 레포라 노출되는 정보가 없다. 검사한 commit과 확정 spec의 commit이 같은지는 확정 spec을 저장하는 작업에서 확인한다. GitHub는 같은 포크 네트워크의 다른 레포 commit을 이 레포 주소로 읽게 해 줄 수 있는데, 이는 직접 확인하지 못했다.
- 토큰은 수명(기본 1시간) 동안 유효하다. 로그아웃 · 계정 정지 · 관리자 해제가 플랫폼 서버에 바로 반영되지 않는다. 계정 정지 기능을 만들 때 DB 확인을 더할지 다시 본다.
- `alg` 처리와 401 · 503 구분은 jose의 동작과 오류 종류에 기대고 있다. jose를 올리거나 바꾸면 `BE/test/auth.e2e.spec.ts`가 이를 다시 확인한다.
- 자동 테스트는 테스트에서 만든 키로 서명한 토큰으로 검증 경로를 확인한다. 실제 Supabase 토큰은 테스트 계정으로 로그인해 직접(`curl`) 확인한다.
