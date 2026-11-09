# API 계약

- **상태**: 초안
- **관련**: SRS [§2.4 인터페이스](../SRS.md#24-인터페이스)

FE·BE·AI가 서로를 기다리지 않도록 **요청·응답 모양을 먼저 고정**한다. API를 바꾸기 전에 이 문서를 먼저 고치고, 같은 PR에 코드 변경을 싣는다. 그룹 단위 구성은 SRS §2.4, 공통 규칙(오류 응답, 시간 형식)도 거기 있다. 엔드포인트에 따로 적지 않은 오류의 `code`는 HTTP 상태 이름(`NOT_FOUND`, `BAD_REQUEST` 등)이고, 예상하지 못한 서버 오류는 내용을 숨긴 `500 INTERNAL_ERROR`다.

## 인증 (SRS §2.4)

로그인 없이 열기로 정한 API(헬스 체크 `GET /api/health`, 나중에 만들 Playground 공개 조회 — [시스템 정의서](../system-definition.md) §4.4)를 뺀 모든 API는 `Authorization: Bearer <access token>` 헤더가 있어야 한다. 토큰은 FE가 로그인해서 받은 것이고, 검증 방법은 [`auth.md`](auth.md)에 있다. 헤더가 없거나 토큰이 틀리면 어느 API든 아래 `401`을 받는다.

### `GET /api/me` — 로그인한 사용자 (NFR-SEC-03)

요청: 본문 없음 (헤더만).

응답 `200`:

```json
{ "id": "0b6f0c1e-4a52-4d8e-9a1b-3f7d2c5e8a90", "email": "student@example.com", "isAdmin": false }
```

오류: `401 AUTH_REQUIRED` 헤더가 없거나 `Bearer` 형식이 아님 / `401 INVALID_TOKEN` 서명 · 만료 · 발급자 등 검증 실패 / `503 AUTH_UNAVAILABLE` 인증 서버의 공개 키를 받지 못함 — 오류 응답 모양은 SRS §2.4.

## 레포 소유 확인 (SRS §2.4)

### `POST /api/repos/check` — 제출하려는 레포가 내 것인지 미리 확인 (NFR-SEC-04)

로그인한 계정에 연동된 GitHub 계정이 그 레포의 소유자인지, 공개 개인 레포인지 확인한다. FE는 제출 전에 이 API로 미리 안내하고, 제출 API도 같은 확인을 한다. 확인 순서와 이유는 [`auth.md`](auth.md#github-연동과-레포-소유-확인)에 있다.

요청:

```json
{ "repoUrl": "https://github.com/student/my-app" }
```

응답 `200`:

```json
{ "repo": "student/my-app" }
```

오류 (`code`: 의미):

- `400 INVALID_REPO_URL`: `https://github.com/<소유자>/<레포>` 모양이 아니거나 `repoUrl`이 없다 · 문자열이 아니다
- `401 AUTH_REQUIRED` · `401 INVALID_TOKEN`: 로그인 토큰 문제 (위 인증 그룹)
- `403 GITHUB_NOT_LINKED`: 이 계정에 GitHub가 연동되어 있지 않다 → 프로필에서 연동하도록 안내
- `403 REPO_NOT_OWNED`: 연동한 GitHub 계정이 레포 소유자가 아니다
- `404 REPO_NOT_FOUND`: 없는 레포이거나 비공개 레포다
- `422 REPO_NOT_PERSONAL`: 소유자가 조직이다 (MVP는 공개 개인 레포만)
- `503 AUTH_UNAVAILABLE` · `503 GITHUB_UNAVAILABLE`: 인증 서버 또는 GitHub에 닿지 못했거나, 서버가 가진 Supabase 공개 키가 거부당했다. 사용자 잘못이 아니므로 다시 시도하게 한다

### `POST /api/repos/dockerfiles` — 내 레포의 어느 폴더에 Dockerfile이 있는지 확인 (이슈 #25)

FE 흐름은 ① `POST /api/repos/check`로 내 레포인지 확인 → 통과하면 ② 이 API로 Dockerfile을 확인한다. 이 API를 직접 부르는 요청도 막아야 하므로 서버가 `repos/check`와 같은 소유 확인을 **먼저 다시 한다**(순서와 오류는 [`auth.md`](auth.md#github-연동과-레포-소유-확인)). 남의 레포는 Dockerfile 조회까지 가지 않는다.

레포의 **기본 브랜치 최신 상태**에서 파일 이름이 정확히 `Dockerfile`인 경로를 전부 찾는다(하위 폴더 포함. `Dockerfile.prod` · `*.Dockerfile`은 MVP 제외). 빌드할 커밋을 확정하는 일([#41](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/41))이 끝나면 그 커밋을 기준으로 바꾼다. 없을 때 어떻게 할지(반려 · 봇 PR · 플랫폼 템플릿)는 아직 정하지 않았으므로([#25](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/25)) 이 API는 "없음"이라는 사실만 알려 준다.

요청: `POST /api/repos/check`와 같다.

```json
{ "repoUrl": "https://github.com/student/my-app" }
```

응답 `200`:

```json
{ "repo": "student/my-app", "dockerfiles": ["Dockerfile", "BE/Dockerfile"], "truncated": false }
```

- `dockerfiles`: Dockerfile 경로 목록(레포 루트 기준). 없으면 빈 배열이고 **오류가 아니다**.
- `truncated`: GitHub가 너무 큰 레포의 파일 목록을 잘라 보냈으면 `true`. 이때는 빈 목록이어도 "없다"고 단정하지 않는다.

오류: `POST /api/repos/check`와 같고, 파일 목록을 못 받으면 `503 GITHUB_UNAVAILABLE`을 더한다(이미 소유 확인을 통과한 레포라 사용자 잘못이 아니다).

## <그룹명> (SRS §2.4)

### `METHOD /path` — 한 줄 설명 (FR-NNN)

요청:

```json
{}
```

응답 `200`:

```json
{}
```

오류: `400` 입력 오류 / `502` AI 호출 실패 — 오류 응답 모양은 SRS §2.4.

<!-- 엔드포인트마다 위 블록을 복사 -->
