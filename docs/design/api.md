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
{ "repo": "student/my-app", "commit": "0123456789abcdef0123456789abcdef01234567" }
```

- `commit`: 접수 시점에 확정한 **배포할 commit의 전체 SHA**(40자)다. 소유 확인을 통과한 뒤 기본 브랜치(GitHub의 `HEAD`)의 최신 commit을 읽는다. FE는 이 값을 들고 있다가 이후 단계(`repos/deploy-spec` 등)에 그대로 넘겨 모두가 같은 commit을 보게 한다. 커밋이 없는 빈 레포는 `null`이다(오류가 아니다. 배포할 코드가 없을 뿐이다). 이 API는 아직 이 값을 저장하지 않는다.

오류 (`code`: 의미):

- `400 INVALID_REPO_URL`: `https://github.com/<소유자>/<레포>` 모양이 아니거나 `repoUrl`이 없다 · 문자열이 아니다
- `401 AUTH_REQUIRED` · `401 INVALID_TOKEN`: 로그인 토큰 문제 (위 인증 그룹)
- `403 GITHUB_NOT_LINKED`: 이 계정에 GitHub가 연동되어 있지 않다 → 프로필에서 연동하도록 안내
- `403 REPO_NOT_OWNED`: 연동한 GitHub 계정이 레포 소유자가 아니다
- `404 REPO_NOT_FOUND`: 없는 레포이거나 비공개 레포다
- `422 REPO_NOT_PERSONAL`: 소유자가 조직이다 (MVP는 공개 개인 레포만)
- `503 AUTH_UNAVAILABLE` · `503 GITHUB_UNAVAILABLE`: 인증 서버 또는 GitHub에 닿지 못했거나(HEAD commit을 못 읽은 경우 포함), 서버가 가진 Supabase 공개 키가 거부당했다. 사용자 잘못이 아니므로 다시 시도하게 한다

### `POST /api/repos/dockerfiles` — 내 레포의 어느 폴더에 Dockerfile이 있는지 확인 (이슈 #25)

FE 흐름은 ① `POST /api/repos/check`로 내 레포인지 확인 → 통과하면 ② 이 API로 Dockerfile을 확인한다. 이 API를 직접 부르는 요청도 막아야 하므로 서버가 `repos/check`와 같은 소유 확인을 **먼저 다시 한다**(순서와 오류는 [`auth.md`](auth.md#github-연동과-레포-소유-확인)). 남의 레포는 Dockerfile 조회까지 가지 않는다.

레포의 **기본 브랜치 최신 상태**(GitHub의 `HEAD`)에서 파일 이름이 정확히 `Dockerfile`인 경로를 전부 찾는다(하위 폴더 포함. `Dockerfile.prod` · `*.Dockerfile`은 MVP 제외). 빌드할 커밋을 확정하는 일([#41](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/41))이 끝나면 그 커밋을 기준으로 바꾼다. 없을 때 어떻게 할지(반려 · 봇 PR · 플랫폼 템플릿)는 아직 정하지 않았으므로([#25](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/25)) 이 API는 "없음"이라는 사실만 알려 준다.

요청: `POST /api/repos/check`와 같다.

```json
{ "repoUrl": "https://github.com/student/my-app" }
```

응답 `200`:

```json
{ "repo": "student/my-app", "dockerfiles": ["Dockerfile", "BE/Dockerfile"], "truncated": false }
```

- `dockerfiles`: Dockerfile 경로 목록(레포 루트 기준). 없으면 빈 배열이고 **오류가 아니다**. 커밋이 없는 빈 레포도 빈 배열이다.
- `truncated`: GitHub가 너무 큰 레포의 파일 목록을 잘라 보냈으면 `true`. 이때는 빈 목록이어도 "없다"고 단정하지 않는다.

오류: `POST /api/repos/check`와 같고, 파일 목록을 못 받으면 `503 GITHUB_UNAVAILABLE`을 더한다(이미 소유 확인을 통과한 레포라 사용자 잘못이 아니다).

### `POST /api/repos/deploy-spec` — 레포의 `package.json` · 락 파일로 배포 설정 초안 채우기 (이슈 #42)

FE 흐름은 ① `repos/check` → ② `repos/dockerfiles`와 이 API. 이 API도 직접 부를 수 있으므로 서버가 `repos/check`와 같은 소유 확인을 **먼저 다시 한다**(순서와 오류는 [`auth.md`](auth.md#github-연동과-레포-소유-확인)). 남의 레포는 파일 목록 조회까지 가지 않는다.

배포 설정의 **초안**이다. 사용자가 웹에서 검토해 고치거나 그대로 확정하며, 확정한 값을 저장하는 API는 이 문서에 아직 없다(저장 위치가 정해지지 않았다). 초안은 같은 입력(레포 + 기본 브랜치 최신 상태)이면 같은 결과가 나오는 규칙 코드의 출력이라 저장하지 않고 호출할 때마다 계산한다. **README는 읽지 않고 LLM도 쓰지 않으며**, 학생 코드는 읽기만 하고 실행하지 않는다.

읽는 것은 `commit`으로 지정한 commit(없으면 기본 브랜치 최신 상태, GitHub의 `HEAD`)에서 찾은 `package.json`(하위 폴더 포함, `node_modules/` 안은 제외)과, 그 폴더에서 가장 가까운 락 파일의 **이름**이다. 락 파일 내용은 읽지 않는다. FE는 `repos/check`가 돌려준 `commit`을 넘겨, 접수 뒤 사용자가 push해도 초안이 접수 때의 파일을 보게 한다([#41](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/41) · [#60](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/60)).

요청: `POST /api/repos/check`와 같고, 선택으로 `commit`을 받는다.

```json
{ "repoUrl": "https://github.com/student/my-app", "commit": "0123456789abcdef0123456789abcdef01234567" }
```

- `commit`(선택): 읽을 commit의 **전체 SHA**(40자, 소문자 16진수). 없으면(`null`도 같다. `repos/check`가 빈 레포에 `null`을 주므로 그대로 넘겨도 된다) `HEAD`를 읽고 응답의 `commit`은 `null`이다. 짧은 SHA · 브랜치 이름 · 대문자 · 빈 문자열 · 공백이 낀 값 · 문자열이 아닌 값(숫자 · 배열 · 객체)은 받지 않는다(`400 INVALID_COMMIT`). 다듬어(trim) 받아 주지는 않는다.

응답 `200` (모양은 [#46](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/46)이 정해질 때까지 잠정이다):

```json
{
  "repo": "student/my-app",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "projects": [
    {
      "dir": "BE",
      "framework": { "value": null, "source": null },
      "language": { "value": "typescript", "source": "package.json" },
      "packageManager": { "value": "pnpm", "source": "lockfile" },
      "install": { "value": "pnpm install --frozen-lockfile", "source": "lockfile" },
      "build": { "value": "pnpm run build", "script": "nest build", "source": "package.json" },
      "start": { "value": "pnpm run start", "script": "node dist/main", "source": "package.json" },
      "outputDir": { "value": null, "source": null },
      "port": { "value": null, "source": null },
      "nodeVersion": null,
      "lockfile": "BE/pnpm-lock.yaml",
      "dockerfile": true,
      "needsReview": ["framework", "outputDir", "port"]
    },
    {
      "dir": "FE",
      "framework": { "value": "vite-react", "source": "package.json" },
      "language": { "value": "typescript", "source": "package.json" },
      "packageManager": { "value": "pnpm", "source": "lockfile" },
      "install": { "value": "pnpm install --frozen-lockfile", "source": "lockfile" },
      "build": { "value": "pnpm run build", "script": "tsc -b && vite build", "source": "package.json" },
      "start": { "value": null, "script": null, "source": null },
      "outputDir": { "value": "dist", "source": "default" },
      "port": { "value": null, "source": null },
      "nodeVersion": ">=22",
      "lockfile": "FE/pnpm-lock.yaml",
      "dockerfile": true,
      "needsReview": []
    }
  ],
  "truncated": false
}
```

- `projects`: `package.json`이 있는 폴더마다 한 항목(레포 루트는 `dir: "."`). 하나도 없으면 빈 배열이고 **오류가 아니다**(Node가 아닌 레포 · 커밋이 없는 빈 레포). 폴더는 얕은 것부터 이름순으로 **최대 10개**만 읽는다. `workspaces`를 선언했거나 같은 폴더에 `pnpm-workspace.yaml`이 있는 `package.json`이 프레임워크도 알아볼 수 없으면, 배포 대상이 아닌 워크스페이스 루트로 보고 `projects`에서 뺀다(하위 패키지는 각자 항목이 된다).
- `commit`: 요청에서 받은 commit 그대로이고, 요청에 없으면 `null`이다(HEAD를 읽었다는 뜻). FE는 확정 spec에 이 값을 담아 둔다.
- `truncated`: GitHub가 너무 큰 레포의 파일 목록을 잘랐거나, 폴더가 10개를 넘어 일부를 읽지 않았으면 `true`. 이때는 목록이 전부가 아니고, 각 폴더의 `lockfile: null` · `dockerfile: false`도 "없다"고 단정할 수 없다(잘려 나간 파일일 수 있다).
- 항목은 `{ value, source }`이고 `source`는 값을 어디서 얻었는지(`package.json` · `lockfile` · `default`)다. 값이 없으면 `null`이다. `build` · `start`는 `script`를 더하고, `nodeVersion` · `lockfile`(문자열 또는 `null`)과 `dockerfile`(불리언)은 `{ value, source }`가 아닌 값 그대로다.
- **`needsReview`**: 자동으로 정하지 못해 사용자가 골라야 하는 항목 이름이다(값은 `null`). 후보가 여럿이라 못 정한 항목은 `candidates`(문자열 배열)를 더해 후보를 알린다(예: `{ "value": null, "source": null, "candidates": ["npm", "pnpm"] }`). 값이 `null`인데 `needsReview`에 없으면 "해당 없음"이다(정적 사이트의 `start` · `port`, Next.js의 `outputDir`).
- `dockerfile`: 그 폴더에 `Dockerfile`이 있는지(`repos/dockerfiles`와 같은 파일 목록). 없을 때 어떻게 할지는 정해지지 않았다([#25](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/25)). 이 API는 사실만 알려 준다.
- `nodeVersion`: `package.json`의 `engines.node` 문자열 그대로. 없으면 `null`.

**감지 규칙** (지원 1순위 Vite + React · Next.js · TypeScript. 나머지는 판단 필요):

| 항목 | 규칙 |
| --- | --- |
| 프레임워크 | 의존성(`dependencies` + `devDependencies`)에 `next` → `nextjs`, `vite` + `react` → `vite-react`. 둘 다 있거나(`candidates`로 알림) 어느 쪽도 아니면 `null` + 판단 필요 |
| 언어 | `typescript` 의존성이 있으면 `typescript`, 없으면 `javascript` |
| 락 파일 | 그 폴더에서 시작해 **가장 가까운 상위 폴더**까지 올라가며 처음 나오는 락 파일(`pnpm-lock.yaml` · `package-lock.json` · `yarn.lock` · `bun.lock` · `bun.lockb`). 워크스페이스는 락이 루트에 있기 때문이다. 설치 명령은 응답의 `lockfile`이 있는 폴더에서 실행해야 한다(없으면 `dir`) |
| 패키지 매니저 · 설치 명령 | 락 파일 종류로 정한다: pnpm → `pnpm install --frozen-lockfile`, npm → `npm ci`, yarn → `yarn install --frozen-lockfile`(`packageManager`가 `yarn@2` 이상이면 `yarn install --immutable`), bun → `bun install --frozen-lockfile`. 같은 폴더에 **서로 다른 패키지 매니저의 락 파일**이 여럿이거나(`bun.lock`과 `bun.lockb`는 같은 bun이라 충돌이 아니다) `packageManager`와 **어긋나면** 판단 필요(`candidates`). `packageManager`는 `pnpm@9.1.0+sha512…`처럼 버전 · 해시가 붙으므로 `@` 앞의 이름만 비교하고, npm · pnpm · yarn · bun이 아닌 이름은 없는 것으로 본다 |
| 락 파일이 없을 때 | 프레임워크 · 언어 · 빌드는 `package.json`만으로 정한다. 패키지 매니저는 `packageManager`가 있으면 그것(`source: package.json`), 없으면 `npm`(`source: default`)이고 설치 명령은 고정 설치가 아닌 `<pm> install`이다. `lockfile`은 `null`이다 |
| 빌드 · 시작 명령 | `scripts.build` · `scripts.start`가 있으면 `<pm> run build` · `<pm> run start`로 보여 주고 실제 스크립트 문자열을 `script`에 함께 담는다. **스크립트가 없으면 프레임워크 기본 명령을 지어내지 않고** 판단 필요다(단 정적 사이트의 `start`는 해당 없음). 패키지 매니저를 못 정했으면(판단 필요) 스크립트가 있어도 `<pm>`을 모르니 `value`는 `null`이고 `script`와 `source: package.json`만 채우며 판단 필요다 |
| 출력 폴더 · 포트 | 프레임워크 기본값 표만 쓴다: `vite-react` → 출력 폴더 `dist`(시작 명령 · 포트 없음, 정적), `nextjs` → 포트 `3000`(출력 폴더 없음). 스크립트 · README는 파싱하지 않는다. 프레임워크를 모르면 판단 필요 |

오류: `POST /api/repos/check`와 같고, `400 INVALID_COMMIT`(`commit`이 있는데 전체 SHA 모양이 아니다. 외부 호출 전에 거른다)과 `404 COMMIT_NOT_FOUND`(그 레포에 없는 SHA다. GitHub는 없는 SHA · 다른 레포의 SHA · commit이 아닌 tree SHA에 모두 `422`로 답하고 커밋이 없는 빈 레포는 `409`이므로 한꺼번에 이 오류로 돌려준다)를 더한다. 파일 목록이나 `package.json`을 못 받으면 `503 GITHUB_UNAVAILABLE`을 더한다(이미 소유 확인을 통과한 레포라 사용자 잘못이 아니다). 읽은 `package.json`이 JSON 객체가 아니거나 1,000,000바이트를 넘어 읽지 않았으면(크기는 파일 목록에 있다. 큰 파일로 서버 메모리를 쓰지 못하게 한다) 오류가 아니라, `package.json`에서 알아내는 항목(프레임워크 · 언어 · 빌드/시작 명령 · 출력 폴더 · 포트)이 그 폴더만 판단 필요다. 락 파일과 Dockerfile로 아는 값(패키지 매니저 · 설치 명령 · `dockerfile`)은 그대로 채운다. 읽는 사이 `package.json`이 사라져 `404`가 나도 같다(읽는 사이 push가 있을 수 있다).

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
