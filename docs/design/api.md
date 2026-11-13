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

배포 설정의 **초안**이다. 사용자가 웹에서 검토해 고치거나 그대로 확정하며, 확정한 값을 저장하는 API는 이 문서에 아직 없다(저장 위치가 정해지지 않았다). 초안은 같은 입력(레포 + commit. `commit`이 없으면 기본 브랜치 최신 상태)이면 같은 결과가 나오는 규칙 코드의 출력이라 저장하지 않고 호출할 때마다 계산한다. **README는 읽지 않고 LLM도 쓰지 않으며**, 학생 코드는 읽기만 하고 실행하지 않는다.

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

오류: `POST /api/repos/check`와 같고, `400 INVALID_COMMIT`(`commit`이 있는데 전체 SHA 모양이 아니다. 외부 호출 전에 거른다)과 `404 COMMIT_NOT_FOUND`(그 레포에 없는 SHA다. GitHub는 없는 SHA · 다른 레포의 SHA · commit이 아닌 tree SHA에 `422`, 커밋이 없는 빈 레포에 `409`, 그 밖에 `404`로 답하고, `200`이어도 돌려준 SHA가 요청한 SHA와 다르면 같은 경우라서 모두 이 오류로 돌려준다)를 더한다. 파일 목록이나 `package.json`을 못 받으면 `503 GITHUB_UNAVAILABLE`을 더한다(이미 소유 확인을 통과한 레포라 사용자 잘못이 아니다). 읽은 `package.json`이 JSON 객체가 아니거나 1,000,000바이트를 넘어 읽지 않았으면(크기는 파일 목록에 있다. 큰 파일로 서버 메모리를 쓰지 못하게 한다) 오류가 아니라, `package.json`에서 알아내는 항목(프레임워크 · 언어 · 빌드/시작 명령 · 출력 폴더 · 포트)이 그 폴더만 판단 필요다. 락 파일과 Dockerfile로 아는 값(패키지 매니저 · 설치 명령 · `dockerfile`)은 그대로 채운다. 읽는 사이 `package.json`이 사라져 `404`가 나도 같다(읽는 사이 push가 있을 수 있다).

## 배포 입력 저장 (이슈 #76)

접수 때 확정한 commit과 사용자가 검토해 고친 배포 설정(spec)을 서버가 검증해 Supabase에 저장한다. W3(비밀값), W4(빌드), 리더의 W5가 모두 같은 값을 읽는다. 배포마다 행 하나이고 저장한 뒤에는 바꾸지 않는다(고치려면 새로 저장한다). 행의 `id`가 배포 입력의 `deployId`다. 실행할 때마다 새로 만드는 `deploy_condition`(`buildInputHash` · `image` 등)은 여기에 담지 않는다([#44](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/44)).

### `POST /api/deploys` — 배포 입력(commit + spec) 확정 · 저장

FE 흐름은 `repos/check`(commit 확정) → `repos/dockerfiles` · `repos/deploy-spec`(초안) → 사용자가 검토해 고침 → 이 API. 초안이 알 수 없는 칸(`slug` · `name` · `role` · `health` · `ingressPath` · `links` 등)은 사용자가 채우거나 FE가 기본값을 둔다. 서버는 FE가 보낸 값을 믿지 않고 아래 순서로 다시 확인한다(순서와 이유는 [`auth.md`](auth.md#배포-입력-저장)).

요청:

```json
{
  "repoUrl": "https://github.com/student/my-app",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "spec": {
    "project": { "slug": "my-app", "repo": "student/my-app" },
    "services": [
      {
        "name": "fe",
        "role": "fe",
        "dir": "FE",
        "build": {
          "context": "FE",
          "dockerfile": null,
          "framework": "vite-react",
          "nodeVersion": "22",
          "install": "pnpm install --frozen-lockfile",
          "build": "pnpm run build",
          "start": null,
          "outputDir": "dist",
          "buildEnv": { "VITE_API_URL": "/api" }
        },
        "runtime": {
          "kind": "static",
          "port": 8080,
          "health": { "type": "http", "path": "/", "startupTimeoutSeconds": 10 },
          "env": {},
          "secretKeys": [],
          "links": [],
          "ingressPath": "/",
          "stripPrefix": false,
          "resources": null
        }
      },
      {
        "name": "be",
        "role": "be",
        "dir": "BE",
        "build": {
          "context": ".",
          "dockerfile": "BE/Dockerfile",
          "framework": null,
          "nodeVersion": null,
          "install": null,
          "build": null,
          "start": null,
          "outputDir": null,
          "buildEnv": {}
        },
        "runtime": {
          "kind": "server",
          "port": 3000,
          "health": { "type": "http", "path": "/api/health", "startupTimeoutSeconds": 60 },
          "env": { "NODE_ENV": "production" },
          "secretKeys": ["DATABASE_URL"],
          "links": [],
          "ingressPath": "/api",
          "stripPrefix": false,
          "resources": null
        }
      }
    ]
  }
}
```

응답 `201`:

```json
{
  "id": "6f1c0a52-3b7e-4a40-9a6c-2f5d8e1b7c90",
  "repo": "student/my-app",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "spec": { "project": { "slug": "my-app", "repo": "student/my-app" }, "services": ["…요청의 spec 그대로"] },
  "createdAt": "2026-11-10T01:00:00.000Z"
}
```

- 요청 본문은 100KB까지다(넘으면 `413 PAYLOAD_TOO_LARGE`). `repoUrl` · `commit` · `spec` 말고 다른 키(`user_id` 등)는 무시한다. 소유자는 항상 로그인 토큰의 사용자다.
- `commit`은 필수이고 전체 SHA(40자 소문자 16진수)다. `repos/check`가 빈 레포에 주는 `null`은 받지 않는다(배포할 코드가 없다. `400 INVALID_COMMIT`).
- `repo`는 GitHub가 돌려준 `owner/name` 표기다. `spec.project.repo`는 이 값과 같아야 한다(대소문자는 구분하지 않는다).
- `spec`은 검증을 통과한 값 그대로 저장하고 돌려준다. 서버가 값을 고치거나 채우지 않는다.
- `createdAt`은 UTC ISO 8601이다.

**서버가 확인하는 순서** (앞에서 걸리면 뒤는 하지 않는다):

1. 모양 검사(외부 호출 없음): `repoUrl` 모양 → `400 INVALID_REPO_URL`, `commit` → `400 INVALID_COMMIT`, `spec` → `400 INVALID_SPEC`
2. `repos/check`와 같은 소유 확인(로그인 · GitHub 연동 · 공개 · 개인 레포 · 소유자 대조)
3. `commit`이 이 레포의 commit인지 확인 → 아니면 `404 COMMIT_NOT_FOUND` (`deploy-spec`과 같다)
4. `spec.project.repo`가 확인한 레포와 같은지 → 아니면 `400 INVALID_SPEC`
5. `spec.project.slug`가 다른 사용자나 다른 레포에 이미 쓰이지 않는지 → 쓰이면 `409 SLUG_TAKEN` (같은 사용자의 같은 레포가 다시 저장하는 것은 된다. 클러스터 네임스페이스 `proj-<slug>`와 공개 주소가 `slug`로 정해지기 때문이다)
6. 저장

**`spec` 검증 규칙.** 표에 있는 칸은 **모두 필수**다(값이 없으면 키를 빼지 말고 `null`을 보낸다. 빠진 키는 `REQUIRED`). 모르는 키는 거부한다(오타가 조용히 저장되지 않게). `400 INVALID_SPEC`은 어긋난 칸을 **칸마다** 알려 준다. 오류 응답의 `error`에 선택 필드 `fields`가 더해진다(다른 오류에는 없다):

```json
{
  "error": {
    "code": "INVALID_SPEC",
    "message": "spec has invalid fields (first: services[0].build.install)",
    "fields": [
      { "path": "services[0].build.install", "code": "REQUIRED" },
      { "path": "services[1].runtime.port", "code": "OUT_OF_RANGE" }
    ]
  }
}
```

- `path`: `spec` 안의 칸 경로(`project.slug`, `services[1].runtime.port`, `services[0].runtime.links[0].service`). 배열은 `[번호]`다. 칸 하나가 아니라 값 사이의 규칙을 어긴 경우는 그 규칙이 고치라고 가리키는 칸의 경로다.
- `code`: 문장이 아니라 코드로 가른다. `message`는 사람이 읽는 요약이라 코드 대신 쓰지 않는다. 한 칸에 코드는 하나이고 최대 20칸까지 알려 준다.

| `code` | 뜻 |
| --- | --- |
| `REQUIRED` | 있어야 하는데 없거나 `null`이다 (`dockerfile`이 없으면 필수인 칸 등) |
| `MUST_BE_NULL` | `null`이어야 하는데 값이 있다 (`dockerfile`이 있으면 `framework` ~ `outputDir`, 정적이면 `start` 등) |
| `INVALID_TYPE` | JSON 타입이 틀렸다 (문자열 자리에 숫자 등) |
| `INVALID_VALUE` | 허용 값 목록이나 모양에 맞지 않는다 (`framework`, `nodeVersion`, 경로, 이름 등) |
| `OUT_OF_RANGE` | 숫자 범위를 벗어났다 (`port`, `startupTimeoutSeconds`, 서비스 개수) |
| `DUPLICATE` | 서로 달라야 하는 값이 같다 (`services[].name`, `services[].role`, `runtime.ingressPath`, `secretKeys`, `links[].env`). 뒤에 나온 쪽 칸에 알린다 |
| `UNKNOWN_KEY` | 모르는 키다 |
| `UNKNOWN_SERVICE` | `links[].service`가 `spec.services`에 없는 이름이다 |
| `RESERVED` | 예약된 이름이다 (`project.slug`) |
| `CONFLICT` | 칸 사이가 맞지 않는다 (`buildEnv`의 키가 `secretKeys`와 겹침, `env`의 키가 `secretKeys`와 겹침, `links[].env`가 `env`의 키나 `secretKeys`와 겹침, 정적인데 `port`가 8080이 아님, `env` · `secretKeys` · `links`가 비어 있지 않음) |
| `MISMATCH` | 확인한 레포와 다르다 (`project.repo`) |

FE가 select에 넣을 허용 값: `role` = `fe` · `be` · `ai`, `runtime.kind` = `server` · `static`, `build.framework` = `vite-react` · `nextjs` · `nest`(또는 `null`), `runtime.health.type` = `http` · `tcp`. `build.nodeVersion`은 서버가 `22` · `22.1` · `22.1.0` 모양만 받고 **변환하지 않는다**(초안의 `engines.node` 원문 `>=22`는 받지 않는다. FE가 `22` 같은 값을 미리 채워 두거나 사용자가 고르게 한다). 초안(`deploy-spec`의 `projects[]`)을 입력(`spec.services[]`)으로 옮기는 것도 이번에는 FE가 한다(초안이 모르는 칸은 사용자가 채운다). 서버는 `spec` 하나를 받아 검증할 뿐이다.

| 칸 | 규칙 |
| --- | --- |
| `project.slug` | 소문자 영숫자와 `-`, 영숫자로 시작하고 끝남, 1~40자(`deploy-handoff.md`의 검증 규칙과 같다. 공간 이름 `proj-<slug>`와 이미지 태그가 DNS · 태그 한도 안에 들어간다). 예약 이름 불가(목록의 정본은 [`cluster.md`](cluster.md) §9 공개 진입. 서버 코드는 그 목록을 따른다) |
| `project.repo` | `owner/name` |
| `services` | 1~3개. `name`은 서비스 사이에서 유일하고, `role`은 역할마다 최대 하나, `runtime.ingressPath`는 서비스끼리 같지 않다(`null`은 제외. 같은 문자열만 겹침으로 본다. `/`와 `/api`는 같이 쓴다) |
| `services[].name` | 소문자로 시작하는 소문자 영숫자와 `-`, 영숫자로 끝남, 1~30자. Deployment · Service 이름의 앞부분이자 클러스터 안 DNS 이름이다(슬롯 이름 `<name>-a` · `<name>-b`가 붙어도 63자 이내) |
| `role` | `fe` · `be` · `ai`, 역할마다 서비스 하나까지 |
| `dir` · `build.context` · `build.dockerfile` · `build.outputDir` | 레포 안 상대 경로: `.` 하나이거나 영숫자 · `.` · `_` · `@` · `+` · `-`로 된 조각을 `/`로 이은 것(200자 이하, `/`로 시작 · `..` · `.` 조각 · 빈 조각 · `\` · 공백 불가, 조각은 `-`로 시작할 수 없다: 명령 옵션으로 읽히지 않게). `dockerfile` · `outputDir`은 `null` 가능 |
| `build.framework` | `null` · `vite-react` · `nextjs` · `nest` |
| `build.nodeVersion` | `null` 또는 `22` · `22.1` · `22.1.0` 모양 |
| `build.install` · `build` · `start` | `null` 또는 비어 있지 않은 한 줄 문자열(공백만이거나 줄바꿈이 있으면 불가, 1000자 이하) |
| `build.buildEnv` · `runtime.env` | 키는 `[A-Za-z_][A-Za-z0-9_]*`(128자 이하, `__proto__` 불가), 값은 문자열(4096자 이하). 항목은 100개까지 |
| `runtime.kind` | `server` · `static` |
| `runtime.port` | 1~65535 정수 |
| `runtime.health` | `type`이 `http`면 `path`는 `/`로 시작하고 공백이 없는 문자열(200자 이하), `tcp`면 `path`는 `null`. `startupTimeoutSeconds`는 5~300 정수 |
| `runtime.secretKeys` | env 이름 배열(중복 불가, 100개까지). 값은 저장하지 않는다(W3이 Secret으로 따로 넣는다) |
| `runtime.links` | `{ env, service }` 배열(30개까지, `env`는 서로 달라야 함). `env`는 env 이름이고 `service`는 `spec.services`에 있는 `name` |
| `runtime.ingressPath` | `null`(내부 전용), `/`, 또는 `/api` · `/api/v1`처럼 끝 슬래시 없는 경로(영숫자 · `.` · `_` · `~` · `-` 조각, 200자 이하) |
| `runtime.stripPrefix` | 불리언 |
| `runtime.resources` | 지금은 `null`만 받는다(모양이 정해지면 추가) |

칸 사이의 규칙:

- `build.dockerfile`이 있으면 `framework` · `nodeVersion` · `install` · `build` · `start` · `outputDir`은 모두 `null`
- `build.dockerfile`이 `null`이면 `framework` · `nodeVersion` · `install` · `build`가 필수, `kind: server`면 `start` 필수 · `outputDir`은 `null`, `kind: static`이면 `outputDir` 필수 · `start`는 `null`
- `kind: static`이면 `port`는 8080, `env` · `secretKeys` · `links`는 비어 있음
- `buildEnv`의 키와 `secretKeys`는 겹칠 수 없다(`buildEnv`는 번들에 박히는 공개 값이다)
- `env`의 키와 `secretKeys`는 겹칠 수 없다(비밀 값이 평문으로 저장되지 않게). `links[].env`도 `env`의 키나 `secretKeys`와 겹칠 수 없다

오류 (`code`: 의미):

- `400 INVALID_REPO_URL` · `400 INVALID_COMMIT` · `400 INVALID_SPEC`: 위 1 · 4번. `INVALID_SPEC`에는 `fields`가 있다. 본문이 JSON이 아니거나 객체 · 배열이 아닌 최상위 값(`"x"`)이면 JSON 파서가 먼저 `400 BAD_REQUEST`로 거른다
- `413 PAYLOAD_TOO_LARGE`: 요청 본문이 100KB를 넘는다
- `401 AUTH_REQUIRED` · `401 INVALID_TOKEN`: 로그인 토큰 문제
- `403 GITHUB_NOT_LINKED` · `403 REPO_NOT_OWNED` · `404 REPO_NOT_FOUND` · `422 REPO_NOT_PERSONAL`: `POST /api/repos/check`와 같다
- `404 COMMIT_NOT_FOUND`: 그 레포에 없는 commit. 이번에는 "검사한 commit과 입력의 commit이 다르다"는 오류가 따로 없다. 서버가 아직 검사한 commit(#45 보안 검사 결과)을 기억하지 않아서이고, 보안 검사가 들어오면 그 commit과 다를 때의 오류를 이 문서에 더한다. FE는 `COMMIT_NOT_FOUND`를 받으면 `repos/check`부터 다시 하게 하면 된다
- `409 SLUG_TAKEN`: 다른 사용자나 다른 레포가 쓰는 `slug`
- `503 AUTH_UNAVAILABLE` · `503 GITHUB_UNAVAILABLE`: `repos/check`와 같다
- `503 DATABASE_UNAVAILABLE`: 저장소(Supabase)에 닿지 못했거나 서버의 키가 거부당했다. 사용자 잘못이 아니므로 다시 시도하게 한다. 저장됐는지 알 수 없는 시간 초과면 같은 입력을 다시 보내도 된다(이미 저장됐다면 행이 하나 더 생길 뿐 같은 배포를 덮어쓰지 않는다)

### `GET /api/deploys/:id` — 저장한 배포 입력 읽기

응답 `200`: `POST /api/deploys`의 `201`과 같은 모양(`id` · `repo` · `commit` · `spec` · `createdAt`).

오류: `401`(위와 같다), `404 DEPLOY_NOT_FOUND`(없는 `id`이거나 내 것이 아니다. `id`가 UUID 모양이 아니어도 같다. 남의 배포가 있는지 알려 주지 않으려는 것이다), `503 DATABASE_UNAVAILABLE`.

## 비밀값 (이슈 #43 · #82)

확정한 배포 입력(`spec`)의 `runtime.secretKeys`에는 key 이름만 있다. 값은 사용자에게서 받아 플랫폼 서버가 리더의 쿠버네티스 Secret `<서비스 이름>-secrets`(공간 `proj-<slug>`, 서비스마다 하나, 슬롯 A · B가 같이 쓴다. key는 env 이름 그대로)로 쓴다. 값은 DB · 로그 · 오류 응답 · 빌드에 남기지 않고 **응답으로 돌려주지 않는다**. 값이 거치는 곳은 [`auth.md`](auth.md#비밀값)에 있다.

**서비스 하나를 보내면 그 서비스의 Secret 전체를 바꾼다.** 서버는 Secret을 읽을 권한이 없어(쓰기 전용, [cluster.md](cluster.md) §8) 이미 들어간 값과 합칠 수 없다. 그래서 서비스를 보낼 때는 그 서비스의 `secretKeys`를 **모두** 보낸다(일부 key만 보내는 것은 없다). 서비스는 따로따로 보내도 된다: 이미 `in`인 서비스는 다시 보내지 않으면 그대로 있다.

### `PUT /api/deploys/:id/secrets` — 비밀값 넣기 (내 배포만)

요청:

```json
{
  "services": {
    "be": { "DATABASE_URL": "postgres://...", "JWT_SECRET": "..." }
  }
}
```

- `services`: 서비스 이름 → `{ key: 값 }`. 한 개 이상. 서비스마다 그 서비스의 `secretKeys`와 **정확히 같은 key 집합**이어야 한다(빠진 key도, 모르는 key도 안 된다).
- 값은 문자열이고 **비어 있거나 공백뿐이면 안 된다**(안 채운 것으로 본다). 공백은 다듬지 않는다: 앞뒤 공백이나 줄바꿈이 있는 값은 그대로 들어간다. 값 하나는 8,192자까지이고, 요청 본문은 100KB까지다.
- `secretKeys`가 비어 있는 서비스를 보내도 key가 없으면(`{}`) 아무 일도 하지 않는다. key가 있으면 `UNKNOWN_KEY`다.
- 같은 요청을 다시 보내도 된다(덮어쓴다). 공간 `proj-<slug>`가 없으면 서버가 만든다([space.md](space.md)).

응답 `200`: 아래 `GET`과 같은 모양(값은 없다). 서비스가 여럿이면 서비스 하나씩 차례로 쓰므로 중간에 실패하면 앞의 서비스만 들어간 채 오류가 온다. 그때는 `GET`으로 `in`인 서비스를 확인하고 나머지를 다시 보내면 된다.

오류:

- `400 INVALID_SECRETS`: `error.fields`에 `{ path, code }` 목록(`INVALID_SPEC`과 같은 방식, 최대 20개). 경로는 요청 본문의 `services`가 아니라 `secrets.<서비스>.<KEY>`로 쓴다(배포 시작의 `NOT_READY`가 빠진 key를 알리는 모양과 같다). **값은 응답 · 로그에 싣지 않고 key와 서비스 이름만 알린다.**

| `code` | `path` | 뜻 |
| --- | --- | --- |
| `REQUIRED` | `secrets` | 서비스가 하나도 없다 |
| `REQUIRED` | `secrets.<서비스>.<KEY>` | 그 key가 빠졌다, 값이 비었거나 공백뿐이다 |
| `INVALID_TYPE` | `secrets` · `secrets.<서비스>` · `secrets.<서비스>.<KEY>` | 객체여야 할 곳이 아니거나, 값이 문자열이 아니다 |
| `OUT_OF_RANGE` | `secrets.<서비스>.<KEY>` | 값이 8,192자를 넘는다 |
| `UNKNOWN_SERVICE` | `secrets.<서비스>` | 이 배포에 없는 서비스다 |
| `UNKNOWN_KEY` | `secrets.<서비스>.<KEY>` | 이 서비스의 `secretKeys`에 없는 key다 |

  이름이 서비스 이름 · env 이름 모양이 아니면 그 이름은 응답에 싣지 않고 한 칸 위 경로로 알린다(`secrets` · `secrets.<서비스>`). 한 칸에는 코드가 하나만 남는다.
- `401 AUTH_REQUIRED` · `401 INVALID_TOKEN`, `404 DEPLOY_NOT_FOUND`(없는 `id` · 남의 배포 · UUID가 아닌 `id`), `413 PAYLOAD_TOO_LARGE`(100KB 초과), `400 BAD_REQUEST`(본문이 JSON 객체가 아니거나 JSON으로 읽을 수 없다 — 파서의 오류 문구는 본문 조각을 담을 수 있어 `Request body is not valid JSON`으로 바꿔 돌려주고, 본문 내용은 응답 · 로그에 싣지 않는다).
- `503 CLUSTER_UNAVAILABLE`: 리더에 닿지 못했거나, 서버의 클러스터 접속 설정이 없거나, 거절당했다. 사용자 잘못이 아니므로 **입력한 값을 남겨 두고 다시 시도하게 한다.** 쓴 서비스는 `in`이 되지 않는다(이미 `in`이던 서비스를 다시 보내다 실패하면 그 서비스는 `missing`으로 바뀐다. 새 값이 들어갔는지 알 수 없어서이고, 다시 보내면 된다).
- `503 DATABASE_UNAVAILABLE`: 상태를 저장하지 못했다. 같은 이유로 다시 보내면 된다.

### `GET /api/deploys/:id/secrets` — 비밀값 상태 읽기 · 빌드 준비됨 (내 배포만)

응답 `200` (**값은 없다**. `secretKeys`가 비어 있지 않은 서비스만 나온다):

```json
{
  "ready": false,
  "secretHash": null,
  "services": [
    { "name": "be", "status": "in", "keys": [ { "key": "DATABASE_URL", "status": "in" }, { "key": "JWT_SECRET", "status": "in" } ] },
    { "name": "ai", "status": "missing", "keys": [ { "key": "OPENAI_API_KEY", "status": "missing" } ] }
  ]
}
```

- `status`는 `in`(들어감) 또는 `missing`(빠짐)이다. **서비스 단위로 전부 들어가거나 전부 빠진다**(Secret을 통째로 바꾸므로). 그래서 한 서비스의 key는 모두 서비스와 같은 `status`다. 이 응답은 서버가 쓴 기록이고, 리더의 Secret을 읽어 확인한 것이 아니다(읽기 권한이 없다).
- `in`이 되려면 지금 `secretKeys`와 **같은 key 집합**으로 쓴 기록이 있어야 한다. 같은 프로젝트(`slug`)의 이전 배포가 이미 넣은 Secret이 key까지 같으면 다시 입력하지 않아도 `in`이다. 새 배포가 key를 바꿨다면 그 서비스는 `missing`이고 전체를 다시 보낸다.
- `ready`: `secretKeys`가 있는 모든 서비스가 `in`이면 `true`. 그런 서비스가 하나도 없어도 `true`다(비밀값이 필요 없는 배포). **FE의 "빌드 준비됨"은 이 값이다.**
- `secretHash`: `ready`이고 비밀 env가 하나라도 있으면 `"sha256:" + 64자 hex`, 아니면 `null`. 넣은 값들의 해시이고(아래), W4에 넘기는 `deploy_condition.secretHash`다. 값이 같으면 항상 같은 해시이고, 비밀값이 바뀌면 달라진다.
- 오류: `401`, `404 DEPLOY_NOT_FOUND`, `503 DATABASE_UNAVAILABLE`(리더는 부르지 않는다).

**`secretHash` 계산**: 서비스마다 `HMAC-SHA256(키 = SECRET_HASH_KEY, "service\n" + JSON.stringify([[key, 값], ...]))`(key 순으로 정렬한 쌍, 값은 UTF-8)을 구하고, 서비스 이름 순으로 `[[이름, 서비스 해시], ...]`에 `"combined\n"`을 붙여 같은 방식으로 한 번 더 해시한다(앞의 용도 글자는 두 해시를 가른다). 결과는 `"sha256:" + 64자 hex`다. 값이 DB에 남지 않도록 서비스마다의 해시만 저장하고 전체 해시는 읽을 때 계산한다. 해시는 **서버만 아는 키(`SECRET_HASH_KEY`, 32자 이상)**로 만든다. 키가 없으면 DB 행이나 파드 주석(`wanggane/secret-hash`)의 해시를 읽은 쪽이 짧은 값을 사전 대입으로 맞춰 볼 수 있어서다. 키를 바꾸면 저장된 해시가 새 키로 만든 것과 달라져 `secretHash`가 바뀐다(다시 보내면 맞춰진다). 같은 프로젝트 · 서비스에 거의 동시에 두 번 보내면 기록된 해시가 리더에 마지막으로 들어간 값과 다를 수 있다(드문 경우이고 다시 보내면 맞춰진다).

**빌드 준비 확인 (서버 안, 이슈 #82)**: 배포 시작(`POST /api/deploys/:id/start`, #44)이 빌드를 요청하기 전에 `DeployReadinessService.prepareIfReady(deployId)`를 부른다. 위 `GET`의 `ready`와 같은 판단이다(서비스마다 `secretKeys`와 같은 key 집합이 `in`일 때만 준비됨). 준비됐으면 `DeployConditionService.prepare(deployId, secretHash)`의 결과(W4에 넘기는 배포 입력)를 돌려주고, 아니면 `409 NOT_READY`와 함께 빠진 key를 `error.fields`에 `{ "path": "secrets.<서비스>.<KEY>", "code": "REQUIRED" }`로 싣는다(이름만, 값 · 해시는 없다. 최대 20개). 없는 `deployId`는 `404 DEPLOY_NOT_FOUND`. 이 함수는 사용자를 모르므로 소유 확인은 부르는 쪽이 먼저 한다. 사용자가 보는 "빌드 준비됨"은 새 엔드포인트 없이 위 `GET`의 `ready` · `services`다.

## 배포 시작 · 진행 상태 (이슈 #44 · #98)

저장한 배포 입력(`deployId`)으로 GoCD 파이프라인을 한 번 실행하고, 파이프라인이 보내는 단계 알림으로 진행 상태를 기록하고, 학생이 그 상태를 읽는다([배포 워크플로우](deploy-workflow.md) §1 · §6). 배포마다 실행 기록 행 하나(`deploy_runs`)가 생긴다.

**상태 값**

`status`: `not_started`(저장만 했고 시작하지 않음) · `running` · `fixing`(문제 해결 중: 문제 티켓을 AI 서버가 받아 처리하는 중) · `needs_user`(사용자 조치 필요) · `succeeded` · `failed`. `not_started`만 실행 기록 행이 없는 상태다. `needs_user`는 AI 에이전트의 해결 결과를 받는 쪽(별도 이슈)이 정하므로 이 이슈의 코드는 내지 않는다. 배포 대기(FR-054)도 슬롯 대기가 생기면 추가하고 지금은 내지 않는다.

`stage`(지금 도는 파이프라인 스테이지): `build` · `prepare` · `render` · `apply` · `verify` · `switch`. 시작 전이거나 끝난 뒤(`succeeded`)는 `null`이다. 실패하면 실패한 스테이지가 남는다.

`steps`(FR-060 순서, 항상 이 8개): `intake`(접수) · `analysis`(분석) · `config`(배포 설정) · `secrets`(비밀값) · `build`(빌드) · `deploy`(배포) · `verify`(동작 확인) · `done`(완료). 각 `state`는 `done` · `active` · `pending` · `failed`.

- 배포 입력이 저장돼 있으면 `intake` · `analysis` · `config`는 `done`이다.
- `secrets`는 시작 전에는 `active`, 시작한 뒤에는 `done`이다(시작은 비밀값이 준비된 때만 받는다).
- `stage`가 `build`면 빌드, `prepare` · `render` · `apply`면 배포, `verify`면 동작 확인, `switch`면 완료 단계가 `active`다(그 앞 단계는 `done`, 뒤는 `pending`). `succeeded`면 모두 `done`.
- `failed`이면 실패한 스테이지가 속한 단계가 `failed`다. `fixing`이면 그 단계가 `active`로 남는다(해결 중).

### `POST /api/deploys/:id/start` — 배포 시작 (소유자만)

요청 본문은 없어도 되고 `{}`(JSON)도 받는다. 응답 `202`: `{ "deployId", "status": "running", "stage": "build", "targetSlot": "a" | "b" }`. GoCD 파이프라인을 실행하고 바로 돌려준다(끝나기를 기다리지 않는다). FE는 이어서 `GET /api/deploys/:id/status`를 다시 읽는다.

서버가 확인하는 것(순서대로): 내 배포인지(`404`) → 준비 상태가 "준비됨"인지(비밀값 · 필수 env, #82) → 배포 입력과 대상 슬롯을 만들고(`prepare`, #93) → 같은 프로젝트(`slug`)의 배포가 진행 중이 아닌지 → 실행 기록 저장 → 파이프라인 실행.

오류:
- `401` · `404 DEPLOY_NOT_FOUND`: 위와 같다(남의 배포 포함)
- `409 NOT_READY`: 준비가 안 됐다. 빠진 항목은 다른 검증 오류처럼 `error.fields`에 칸마다 `{ path: "secrets.<service>.<KEY>", code: "REQUIRED" }`로 온다(#82의 `DeployReadinessService`가 낸다)
- `409 DEPLOY_IN_PROGRESS`: 같은 프로젝트의 다른 배포가 `running` · `fixing`이다. 그 실행이 1시간 넘게 바뀌지 않았으면 끝난 것으로 보고 `failed`(`TIMED_OUT`)로 마감한 뒤 이 배포를 시작한다(알림이 오지 않거나 `fixing`을 풀 해결 결과 처리가 없어도 프로젝트가 영영 막히지 않게)
- `409 ALREADY_STARTED`: 이 배포는 이미 시작했다(다시 배포하려면 새로 저장한다)
- `503 PIPELINE_UNAVAILABLE`: GoCD에 닿지 못했거나 거절했다. 실행 기록은 남기지 않으므로 같은 요청을 다시 보내도 된다
- `503 DATABASE_UNAVAILABLE`

### `GET /api/deploys/:id/status` — 진행 상태 읽기 (소유자만)

응답 `200`:

```json
{
  "deployId": "…",
  "status": "running",
  "stage": "apply",
  "steps": [
    { "key": "intake", "state": "done" },
    { "key": "analysis", "state": "done" },
    { "key": "config", "state": "done" },
    { "key": "secrets", "state": "done" },
    { "key": "build", "state": "done" },
    { "key": "deploy", "state": "active" },
    { "key": "verify", "state": "pending" },
    { "key": "done", "state": "pending" }
  ],
  "failure": null,
  "agent": null,
  "url": null,
  "warnings": [],
  "updatedAt": "2026-11-11T01:00:00.000Z"
}
```

- `failure`: `status`가 `failed`이거나 `fixing` · `needs_user`면 `{ "code", "stage", "service", "message" }`, 아니면 `null`. `message`는 학생에게 그대로 보여 줘도 되는 고정 문장이고 로그 · 원본 · 비밀값을 담지 않는다. `service`는 모르면 `null`.
- `failure.code`: `BUILD_FAILED` · `DEPLOY_FAILED`(prepare · render · apply) · `VERIFY_FAILED` · `SWITCH_FAILED` · 플랫폼 문제(코드는 열려 있다: `^[A-Za-z][A-Za-z0-9_]{2,63}$`면 받는다. 예: `CODEBUILD_API_ERROR` · `IMAGE_PULL_FAILED` · `LIVE_SLOT_PROTECTED` · `STAGE_NO_REPORT`(스테이지의 결과 파일이 없거나 읽을 수 없음) · `BUILD_WAIT_TIMEOUT` · `NO_IMAGE_DIGEST` · `CHART_RENDER_FAILED` · `SPACE_MISSING` · `K8S_UNREACHABLE`. AI를 부르지 않고 실패로 마감하며, 모르는 코드는 일반 문구로 보여 준다) · `AGENT_UNAVAILABLE`(AI 서버가 티켓을 받지 못함) · `TIMED_OUT`(진행 중인 실행이 1시간 넘게 아무 알림 없이 멈춰 있어 중단함).
- `failure.code`에 `AGENT_GAVE_UP`(AI 에이전트가 해결하지 못하고 결과를 냄)도 있다.
- `agent`: AI 에이전트가 이 실행에 해결 결과(`submit_result`)를 냈으면 `{ "status", "summary", "userRequest": { "message", "secretKeys" } | null, "prUrl": string | null, "evidence": [{ "ref", "text" }] }`, 아니면 `null`. `status`는 `verified` · `pr_opened` · `needs_user` · `gave_up`이다. 학생에게 무엇을 했고(`summary`) 무엇을 해 달라는지(`userRequest`) 보여 주려는 것이다. 외부 전송 필터를 한 번 더 거친 값이고 도구 호출 원본 · 로그는 담지 않는다. `secretKeys`는 다시 넣어야 할 비밀값 key 이름(값 아님)이고 없으면 `[]`, `evidence`는 없으면 `[]`, `ref` · `text`는 없으면 `null`.
- `url`: `succeeded`면 `https://<slug>.stairnoworks.com`, 아니면 `null`.
- `warnings`: 보안 검사(UC-10, #45) 경고. 항목은 `{ "code": string, "message": string, "service": string | null }`이고 `message`는 그대로 보여 줘도 되는 문장이다(비밀값 자체는 싣지 않는다). 배포를 막지 않는다. `service`는 파일이 든 서비스 폴더(spec `dir` 중 가장 긴 접두어)이고 모르면 `null`이다.
  - 검사: 배포 입력을 저장하면(`POST /api/deploys`) 서버가 기다리지 않고 그 레포 · commit을 검사한다. gitleaks(비밀값)와 Trivy(의존성 취약점, HIGH · CRITICAL)를 쓰고, 같은 레포 · commit은 한 번만 검사한다(`security_scans` 표). 동시에 하나만 돈다.
  - 코드: `SECRET_FOUND`(파일 · 줄 · gitleaks 규칙), `ENV_FILE_COMMITTED`(커밋된 `.env` · `.env.*`. 예시 파일 `.example` · `.sample` · `.template` · `.dist`는 뺀다. 빌드에서 빼지는 않는다), `VULNERABLE_DEPENDENCY`(락 파일 · 패키지 · 버전마다 한 줄, 취약점 수 · 가장 높은 심각도 · ID 최대 3개 · 고친 버전), `MORE_FINDINGS`(20줄을 넘으면 마지막 줄이 남은 수), `SCAN_RUNNING`(검사 중. 진행 상태 polling이 멈춘 뒤라면 새로 고침해야 보인다), `SCAN_FAILED`(검사가 끝나지 못했거나 기록을 읽지 못함. "문제 없음"이 아니다), `SCAN_UNAVAILABLE`(서버에 검사가 설정되지 않음, `TRIVY_CACHE_DIR`).
  - 순서: 비밀값 → `.env` → 취약한 패키지(CRITICAL이 있는 것 먼저). 깨끗한 레포는 `[]`다.
  - 검사 기록이 없는 배포(이 기능 전에 저장한 배포)는 읽을 때 검사를 시작하고 `SCAN_RUNNING`을 돌려준다. 15분 넘게 `running`인 기록은 서버가 멈춘 것으로 보고 다시 검사한다.
- **갱신**: FE가 `running` · `fixing`인 동안 3초마다 다시 읽는다(polling). `succeeded` · `failed` · `needs_user`면 멈춘다. 응답은 작게 유지한다(원본 · 로그 없음). SSE · WebSocket은 MVP 밖이다.

오류: `401`, `404 DEPLOY_NOT_FOUND`(없는 id · 남의 id · UUID가 아닌 id 모두), `503 DATABASE_UNAVAILABLE`.

### `GET /api/deploys/:id/metrics` — 내 서비스의 실행 지표 (소유자만, UC-15 · FR-091 · FR-092)

학생이 자기 배포의 서비스별 현재 CPU · 메모리 · 재시작 횟수 · 실행 상태와 최근 1시간 시계열을 읽는다. Grafana는 학생에게 열지 않고 운영자 전용이며, 학생 화면은 이 응답으로 직접 그린다. 읽기만 한다(부작용 없음).

**어느 것의 값인가**: 이 배포가 **프로젝트의 지금 공개 중인 배포**일 때만 값을 준다. 프로젝트의 live 슬롯(`projects.live_slot`)의 Deployment · Pod만 읽고, 다른 슬롯은 보지 않는다. "지금 공개 중인 배포"는 그 프로젝트의 실행 기록 중 `succeeded`인 가장 최근 것(`created_at` 내림차순 첫 줄, 서버의 `findLastSucceededRun`)이다. **가정**: 배포 때 슬롯 줄(`deploy_state`)을 BE가 읽거나 쓰는 곳이 아직 없어서 live 슬롯의 배포 id를 가리키는 정본이 DB에 없다. 있으면 그것이 정본이므로 그때 이 판정을 바꾼다. 그 사이 새 배포가 진행 중이어도(대상 슬롯에서 도는 중) live 슬롯의 배포는 `succeeded`인 채로 남으므로 이 판정은 바뀌지 않는다. 읽는 슬롯은 DB의 `live_slot`이다.

응답 `200`:

```json
{
  "deployId": "…",
  "slug": "my-app",
  "state": "live",
  "reason": null,
  "slot": "a",
  "services": [
    {
      "name": "fe", "deployment": "fe-a",
      "state": "running", "waiting": null,
      "replicas": 1, "readyReplicas": 1, "restarts": 0,
      "usage": { "cpuMillicores": 40, "memoryBytes": 73400320 }
    }
  ],
  "usageStatus": "collected",
  "series": {
    "status": "collected",
    "endT": 1731456000,
    "windowSeconds": 3600,
    "stepSeconds": 60,
    "services": [
      {
        "name": "fe",
        "cpuMillicores": [{ "t": 1794540000, "v": 38 }, { "t": 1794540060, "v": 41 }],
        "memoryBytes": [{ "t": 1794540000, "v": 73400320 }, { "t": 1794540060, "v": 73465856 }]
      }
    ]
  }
}
```

- `state`: `"live"` 또는 `"not_live"`. `not_live`면 값을 주지 않는다: `reason`이 `"not_succeeded"`(이 배포가 `succeeded`가 아니다: 시작 전 · 진행 중 · 실패 · 해결 중 · 사용자 조치 필요) 또는 `"superseded"`(이 배포는 성공했지만 더 새 성공 배포가 있다)이고, `slot` · `usageStatus` · `series`는 `null`, `services`는 `[]`다. `live`면 `reason`은 `null`이다.
- `slot`: live 슬롯 `"a"` · `"b"`.
- `services[]`: live 슬롯의 Deployment 하나(`<서비스>-<슬롯>`)마다 하나. 순서는 서버가 읽은 순서 그대로다.
  - `name`: 서비스 이름(`fe` · `be` · `ai`, Deployment 이름에서 `-<슬롯>`을 뺀 것). `deployment`: Deployment 이름.
  - `state`: `"running"`(원하는 개수가 1 이상이고 모두 준비됨) · `"starting"`(원하는 개수가 1 이상이고 준비 안 된 것이 있다) · `"stopped"`(원하는 개수 0: 운영자가 끈 경우 등). `waiting`: `starting`일 때 기다리는 컨테이너의 이유(`CrashLoopBackOff` · `ImagePullBackOff` 등), 모르거나 `starting`이 아니면 `null`. 학생이 그 말뜻을 알도록 풀어 주는 것은 FE의 일이다.
  - `replicas` · `readyReplicas` · `restarts`: 운영자 API와 같다. `restarts`는 **지금 떠 있는 Pod 기준**이라, 새 배포나 Pod 교체(재시작이 아니라 Pod가 새로 뜬 경우) 뒤에는 0으로 돌아간다. "누적 재시작"으로 읽으면 안 된다.
  - `usage`: 운영자 API의 서비스 `usage`와 같다(합, 정수, 없으면 `null`).
- `usageStatus`: 운영자 API 프로젝트의 `usageStatus`와 같다. `"not_collected"`면 모든 `usage`가 `null`이다.
- 단위: CPU는 밀리코어, 메모리는 바이트, 모두 정수다. 시각 `t`는 유닉스 초다.
- **`series`** (C): `endT`는 서버가 `query_range`에 넘긴 end(유닉스 초), 곧 서버가 쿼리한 "지금"이다(`collected` · `not_collected` 모두에 있고, `series`가 `null`이면 없다). 그래프의 끝은 점이 아니라 이 값이다(수집이 멈춰도 그래프가 멈춘 시점에서 끝나지 않게). 최근 1시간(`windowSeconds` 3600), 1분 간격(`stepSeconds` 60)의 시계열이다. 서비스마다 그 서비스 Pod들의 합이고, 점은 시각 오름차순이다(최대 61개). Prometheus(`query_range`)에서 읽는다([클러스터](cluster.md) §10). 값은 `cpuMillicores` = 컨테이너 CPU 사용 시간의 증가율(`container_cpu_usage_seconds_total`의 2분 `rate`) × 1000, `memoryBytes` = `container_memory_working_set_bytes`다. 두 메트릭 모두 `namespace="proj-<slug>"`, `container!=""`(Pod 전체를 세는 줄 제외), `container!="POD"`(환경에 따라 생기는 pause 컨테이너 줄 제외)로 고르고 Pod별로 읽는다. 이 이름과 셀렉터는 실제 리더에서 확인하지 못했다(미검증).
  - `status`: `"collected"` 또는 `"not_collected"`. Prometheus에 닿지 못했거나 응답을 읽지 못하면 `"not_collected"`이고 `services`는 `[]`다(오류로 답하지 않는다. 현재 값은 위 `services[]`가 따로 준다).
  - `collected`면 `series.services`는 위 `services[]`와 **같은 이름을 모두, 같은 순서로** 담는다(FE가 이름으로 찾다가 빠진 서비스를 오류로 보지 않게). 그 서비스에 점이 없으면(방금 떠서 아직 수집 전, 원하는 개수 0) 그 서비스의 두 배열이 `[]`다. 점이 없는 시각을 메워 넣지 않는다(`v`는 항상 숫자이고, 빠진 시각은 점이 없다).
  - 한 서비스의 Pod가 중간에 바뀌어도(재시작 · 새 배포) 그 시각의 합이다. 서비스 이름에 해당하는 Pod는 `<Deployment>-<ReplicaSet 해시>-<5자>` 이름으로 가른다(운영자 API와 같은 규칙).
- 서버가 PromQL에 넣는 값은 공간 이름 `proj-<slug>`뿐이다. slug는 DB에서 읽은 값이고 슬러그 모양(`^[a-z0-9]…`)을 한 번 더 검사한다. 사용자 입력(쿼리 · 본문)은 PromQL에 들어가지 않는다. 이 API는 쿼리 인자를 받지 않는다.
- 갱신: FE가 화면에 있는 동안 15초 이상 간격으로 다시 읽는다(제안. 서버는 캐시하지 않는다).

오류: `401`, `404 DEPLOY_NOT_FOUND`(없는 id · 남의 id · UUID가 아닌 id), `503 CLUSTER_UNAVAILABLE`(live 슬롯의 Deployment · Pod 목록을 읽지 못했다. 학생에게 서버 계정 권한 같은 내부 이유를 나누어 알리지 않는다), `503 DATABASE_UNAVAILABLE`. 아직 한 번도 성공한 배포가 없는 프로젝트의 배포는 `state: "not_live"`(`not_succeeded`)다.

### `GET /api/deploys` — 내 배포 목록

내 배포를 최신순(`createdAt` 내림차순)으로 돌려준다. 쿼리 `limit`(1~50, 기본 20). 화면이 새로 고침 뒤에도 진행 중인 배포를 찾게 하려는 것이다.

응답 `200`: `{ "deploys": [{ "id", "repo", "slug", "commit", "createdAt", "status", "stage", "url" }] }`. `status` · `stage` · `url`은 위와 같다.

오류: `401`, `400 INVALID_LIMIT`, `503 DATABASE_UNAVAILABLE`.

### 파이프라인 ↔ 플랫폼 서버 (기계용)

> GoCD(서버 설치, 파이프라인 정의, 아래 세 가지를 잇는 task)는 플랫폼 서버 담당이 만든다([배포 워크플로우](deploy-workflow.md#정할-것) 3번, 2026-11-11). 아래 1~3도 그 담당이 정했다. 4번(AI 에이전트의 시험 실행)은 AI 담당이 정하고 GoCD · 파이프라인 담당과 맞췄다. 스테이지 판단 코드(`Infra/pipeline`)가 쓰는 결과 JSON을 아래 알림 모양으로 바꿔 보내는 task도 플랫폼 서버 담당이 만든다. 그 task는 `Infra/pipeline`의 `fetch-input`(아래 2번, `DEPLOY_ID`로 입력을 받아 `deploy-input.json` · `slot` 파일로 저장)과 `notify`(아래 3번, 스테이지 결과 JSON을 알림으로 바꿔 보낸다)이고 사용법은 [`Infra/pipeline/CLAUDE.md`](../../Infra/pipeline/CLAUDE.md)에 있다.

사용자 로그인 토큰이 아니라 **기계용 비밀 토큰** `PIPELINE_NOTIFY_TOKEN`(`Authorization: Bearer`)으로 인증한다. 서버 env에 있고, 같은 값을 GoCD 실행기 컨테이너의 환경변수 `PIPELINE_NOTIFY_TOKEN`으로 넣는다(설정 저장소 파이프라인에는 비밀 변수를 붙일 수 없다. 리더 실행기는 Secret `gocd-agent`, AWS 실행기는 compose env, [플랫폼 호스팅](platform-hosting.md#gocd-서버--aws-실행기)). 4번 시험 경로(입력 읽기 · 결과)도 같은 토큰을 쓴다. 설정이 없거나 틀리면 `401 AUTH_REQUIRED`다. 이 토큰 하나로 배포 완료를 위조할 수 있어 서버는 32자 이상만 받는다. 플랫폼 서버는 GoCD를 주기적으로 조회하지 않는다(§6-1).

**1. 실행**: 서버가 `POST {GOCD_URL}/go/api/pipelines/{GOCD_PIPELINE}/schedule`(헤더 `Accept: application/vnd.go.cd.v1+json` · `X-GoCD-Confirm: true` · `Authorization: Bearer {GOCD_TOKEN}`, GoCD access token)을 부른다. 본문은 `{ "environment_variables": [{ "name": "DEPLOY_ID", "value": "<deployId>" }], "update_materials_before_scheduling": true }`이다. 배포 입력 JSON은 싣지 않고 `deployId`만 넘긴다.

**2. 배포 입력 읽기**: 파이프라인의 첫 task가 `deployId`로 입력을 가져가 JSON 파일로 저장한 뒤 그 경로를 빌드 CLI에 준다.

`GET /api/pipeline/deploys/:deployId/input` → `200 { "deployId", "slot": "a" | "b", "input": { "commitSha", "deploy_condition", "spec" } }`. `input`은 시작할 때 만든 배포 입력이다(`deploy_condition.services`는 채워져 있다). 실행 기록이 없으면 `404 DEPLOY_NOT_FOUND`. 비밀값은 담지 않는다(key 이름만 있다).

**3. 알림**: 각 스테이지가 끝날 때 `POST /api/pipeline/notify`.

```json
{ "deployId": "…", "stage": "build", "result": "passed", "images": { "fe": "ghcr.io/…/student-apps@sha256:…" } }
```

```json
{
  "deployId": "…", "stage": "apply", "result": "failed",
  "failure": { "code": null, "service": "be", "message": "deployment \"be-b\" exceeded its progress deadline",
               "raw": { "codebuild": null, "k8s": { "pod": {}, "events": [], "status": null } },
               "logs": { "from": "…", "to": "…", "lines": [] } }
}
```

- `stage`: `build` · `prepare` · `render` · `apply` · `verify` · `switch`.
- `images`: `build`가 `passed`일 때만 받고 필수다. 빌드한(`run`) 서비스마다 이미지 digest 주소 하나(`reuse` 서비스는 넣지 않는다).
- `failure.code`: 플랫폼 문제면 그 코드(`^[A-Za-z][A-Za-z0-9_]{2,63}$`, 집합은 열려 있고 파이프라인이 정한다. 알려진 코드는 위 예), 아니면 `null`. 모양이 틀리면 400 INVALID_VALUE. 플랫폼 문제는 AI를 부르지 않고 실패로 마감한다.
- `failure.raw` · `failure.logs`: 문제 티켓에 담을 원본과 로그([AI 에이전트 설계](AIagent.md) §5의 `raw` · `logs` 모양). 문제 티켓으로 가는 실패(플랫폼 문제가 아니고 stage가 `build` · `prepare` · `render` · `apply` · `verify`)에서만 확인한다. `build`는 `raw.codebuild`(객체 필수, `raw.k8s`는 없음), 그 밖은 `raw.k8s`(필수, `pod`는 객체 또는 `null`, `events`는 객체 배열, `status`는 `render`일 때만 객체 필수이고 나머지는 `null`)이다. `logs`는 있으면 `from` · `to`(시간대가 있는 ISO 8601)와 문자열 배열 `lines`(마지막 200줄만 쓴다), 없으면 빈 구간으로 보낸다. `apply` · `verify` 실패에서 `failure.service`가 있고 파이프라인이 보낸 `lines`가 비었으면(실행기에는 Pod 로그 권한이 없다) BE가 대상 슬롯의 그 서비스 Pod 중 가장 최근 것(게이트웨이 `read_pod_logs`와 같은 Pod)의 최근 10분 · 마지막 200줄로 채운다(`from` = 지금 − 10분, `to` = 지금, 컨테이너가 재시작했으면 직전 컨테이너). 읽기 전체에 3초 상한을 두고, 넘거나 읽지 못하면 빈 로그로 티켓을 그대로 보낸다(그래서 알림 응답이 늦어지거나 `AGENT_UNAVAILABLE`이 되지 않는다). 안 맞으면 `400 BAD_REQUEST`와 `fields`(`failure.raw.k8s.status` 등)로 보낸 쪽에 알린다. 서버가 비밀값처럼 보이는 문자열을 가린 뒤(spec의 `secretKeys`는 key 이름 목록이라 그대로 둔다) 티켓에 넣고, 어디에도 저장하지 않는다.
- `passed`면 다음 스테이지로 넘어간다. `build`가 `passed`면 새로 빌드한 이미지를 그때 `build_cache`에 기록한다(같은 빌드 입력 해시는 같은 이미지라 뒤 스테이지가 실패해도 재사용해도 된다. 5번 다시 실행과 학생의 다음 배포가 빌드를 건너뛴다). `switch`가 `passed`면 완료다: `live_slot`을 대상 슬롯으로 바꾸고, 공개 주소와 함께 `succeeded`로 기록한다.
- `failed`면 실패 분류에 따라 `failed`로 마감하거나 문제 티켓을 만들어 AI 서버 `POST /agent/tickets`로 보내고 `fixing`으로 둔다(티켓의 `ticketId` 하나만 보관). **`switch` 실패는 티켓 없이 `failed`로 마감한다**(티켓 `stage`에 없다, [AI 에이전트 설계](AIagent.md) §5).
- 응답 `200 { "ok": true }`. 이미 끝난 배포(`succeeded` · `failed`)나 지금 스테이지가 아닌 `stage`의 알림은 상태를 바꾸지 않고 `200 { "ok": true, "applied": false }`이다(재전송해도 안전하다).
- 오류: `401 AUTH_REQUIRED`, `400 BAD_REQUEST`(본문 모양이 다름, `fields` 포함), `404 DEPLOY_NOT_FOUND`(실행 기록 없음), `503 DATABASE_UNAVAILABLE`(파이프라인이 다시 보낸다).

**4. 시험 실행 (AI 에이전트의 `run_build` · `run_render` · `run_deploy` · `run_verify`)**: 문제를 고치는 동안 게이트웨이가 대상 슬롯에서 스테이지 일부만 돌린다([AI 에이전트 설계](AIagent.md) §2 · §3). 위 1~3의 모양은 바꾸지 않는다. 시험 실행은 실행 기록의 상태(`status` · `stage`, 3번 알림의 상태 기계)를 바꾸지 않고, `live_slot` · W7도 건드리지 않는다. BE는 `run_build`(B3) · `run_render` · `run_deploy` · `run_verify`와 아래 두 경로를 구현했다(F11b, `BE/src/gateway/trials.ts` · `tools.ts`). 파이프라인 쪽의 결과 보내기(`trial-report`)와 입력 task의 시험 분기(`?counter`, `build-overrides.json`)는 구현했다(#158). 파이프라인 정의는 [`Infra/gocd/student-trial.gocd.yaml`](../../Infra/gocd/student-trial.gocd.yaml)이다(실제 GoCD로는 아직 돌려 보지 않았다). 결정은 [ADR-014](../adr/014-agent-trial-pipeline-and-rerun.md)(ADR-012 일부 대체)다. 시험은 대상 슬롯에서 고쳐 보는 반복이고(공개 주소 불변), 5번 다시 실행은 확인된 입력으로 한 번 전환하는 것이다.

```
문제 티켓
  │
  ▼  시험 — student-trial, 여러 번, 공개 주소는 바뀌지 않는다
  │    Build(AWS 실행기) → Prepare → Render → Apply → Verify     (TRIAL_STAGES로 일부만)
  │    run_build · run_render · run_deploy · run_verify로 대상 슬롯에서 고쳐 보며 반복
  ▼
verified (submit_result)
  │
  ▼  다시 실행 — student-deploy, 한 번
       Build(모두 reuse) → Prepare → Render → Apply → Verify → Switch → W7
                                                              ▲ 공개 주소는 여기서만 바뀐다
```

공개 주소는 `student-deploy`의 Switch로만 바뀐다. 시험에는 Switch 스테이지가 없고, Switch CLI의 `TRIAL_SWITCH_REFUSED`는 시험 env로 잘못 불렸을 때의 이중 안전이다.

- **파이프라인**: 시험 전용 GoCD 파이프라인 `student-trial`(이름은 BE env `GOCD_TRIAL_PIPELINE`). 스테이지는 Build → Prepare → Render → Apply → Verify다. Build job은 `student-deploy`처럼 AWS 실행기(resource `aws`), 나머지는 리더 실행기에서 돈다. **Switch 스테이지는 없다.** `student-deploy`(1번)는 그대로다. 정의(YAML)는 GoCD 담당이 만든다.
- **실행**: 1번과 같은 요청을 `POST {GOCD_URL}/go/api/pipelines/{GOCD_TRIAL_PIPELINE}/schedule`로 보낸다. `environment_variables`는 셋이다. 비밀값은 넣지 않는다.

| 이름 | 값 |
| --- | --- |
| `DEPLOY_ID` | 실행 기록의 `deployId` (1번과 같다) |
| `TRIAL_ID` | BE가 시험마다 만드는 id `tr_<hex 12자>` |
| `TRIAL_STAGES` | 도구에 따라 넷 중 하나: `build`(`run_build`) · `render`(`run_render`) · `prepare,render,apply`(`run_deploy`) · `verify`(`run_verify`) |

- **스테이지 거르기**: 각 스테이지 job은 자기 스테이지가 `TRIAL_STAGES`에 없으면 아무것도 하지 않고 성공으로 끝난다(결과도 보내지 않는다). 실패하면 GoCD가 뒤 스테이지를 돌리지 않는 것은 그대로다.
- **이중 안전**: Switch CLI는 env `TRIAL_ID`가 있으면 아무것도 바꾸지 않고 플랫폼 문제 `TRIAL_SWITCH_REFUSED`로 끝난다(시험 env로 Switch가 잘못 불려도 공개 주소가 바뀌지 않게).
- **입력**: `GET /api/pipeline/trials/:trialId/input` → `200 { "deployId", "slot", "input", "buildOverrides" }`(앞 셋은 2번과 같은 모양이라 같은 입력 task를 쓰고, `buildOverrides`는 `run_build` 때만 채운다). `slot`은 실행 기록의 대상 슬롯이다. `input`은 도구에 따라 다르다.
  - `run_build`: 실행 기록의 `input`에 그 호출의 `specPatch`(빌드 경로 허용)를 적용하고, 그 서비스의 `deploy_condition`만 패치한 spec으로 다시 계산한다(배포 입력을 만들 때와 같은 빌드 입력 해시 · `build_cache` 규칙으로 `run` / `reuse`). 다른 서비스는 그대로 `reuse`다. 그래서 빌드할 서비스는 입력의 `run` 하나로 정해지고 따로 env가 필요 없다. **다시 계산한 그 서비스가 `reuse`면(같은 해시의 이미지가 이미 있음, #149) BE는 `student-trial`을 schedule하지 않고 바로 `{ ok: true, reused: true, build: null, failedPhase: null, logTail: [], image, failure: null }`로 답한다**: 이미지를 찾는 순서는 아래 `run_render` · `run_deploy`와 같고, 이 호출도 도구 횟수에 세며, 대기가 없어 토큰 만료도 늘리지 않고, 그 이미지를 이 티켓의 시험 이미지로 기억한다. 그래서 `student-trial`의 `run_build` 입력에는 `run` 서비스가 꼭 하나 있다(아니면 `trial-report`가 플랫폼 문제 `TRIAL_INPUT_INVALID`로 보낸다, BE 버그 표시). 고친 `context` · `dockerfile`이 그 commit에 없으면 게이트웨이가 `INVALID_ARGUMENT`로 거절한다. `buildOverrides`(상한은 [AI 에이전트 설계](AIagent.md) §3 표, 게이트웨이가 검사)는 응답의 `input` 옆 `buildOverrides` 칸(`{ computeType?, timeoutMinutes?, image?, cache? }`, 그 밖의 도구는 `null`)으로 준다. 입력 task가 `build-overrides.json`으로 쓰고 Build CLI가 선택 인자로 받아 `StartBuild` override로 넘긴다(`student-deploy`는 그 인자 없이 지금 그대로). `cache: false`는 `cacheOverride: { type: NO_CACHE }`, `true`거나 없으면 override하지 않는다.
  - `run_render` · `run_deploy`: 실행 기록의 `input`에 그 호출의 `specPatch`를 적용하고, 서비스마다 빌드 입력 해시를 다시 계산해 같은 해시의 이미지(실행 기록의 이미지, 이 티켓의 시험 이미지, `build_cache` 순)를 `reuse` digest로 쓴다. 이미지가 없는 서비스가 있으면(빌드 경로를 고치고 아직 `run_build`를 통과하지 않음) 게이트웨이가 `INVALID_ARGUMENT`("먼저 `run_build`")로 거절한다.
  - `run_verify`: 이 티켓의 마지막 `run_deploy`가 성공했으면 그 `input`, 아니면(`run_deploy`가 없거나 마지막 것이 실패함) 실행 기록의 `input`. 실패한 `run_deploy`도 대상 슬롯을 다시 올리므로 그 앞의 성공한 입력은 쓰지 않는다. 대상 슬롯에 떠 있는 것과 Verify가 보는 공개 서비스 · 경로(헬스체크 경로 포함)가 같아야 하기 때문이다.
  - 어느 경우든 `run`이 될 수 있는 것은 `run_build`의 그 서비스 하나뿐이고, 나머지는 모두 `reuse` + 이미지 digest다.
- **live 경로 보호**: stripPrefix Middleware(`<서비스>-strip`)는 슬롯 라벨이 없어 두 슬롯이 같이 쓰고 Apply가 test Ingress와 함께 적용한다. 그래서 게이트웨이는 live 슬롯에 떠 있는 배포 입력(그 프로젝트의 마지막 성공한 실행 기록)에서 `stripPrefix: true`인 서비스의 `ingressPath`를 바꾸는 `specPatch`를 `PATCH_FORBIDDEN`으로 거절한다(메시지에 "live 경로의 Middleware를 같이 바꾼다"). `stripPrefix`를 `false` → `true`로(데모 V2) 또는 `true` → `false`로 바꾸는 것은 받는다: 앞은 live가 그 Middleware를 쓰지 않고, 뒤는 Middleware를 Switch 뒤에만 지우므로 live에 영향이 없다. live 슬롯이 없으면(첫 배포) 막지 않는다.
- **입력 읽기 규칙**: `trialId`가 `^tr_[0-9a-f]{12}$`가 아니거나, 그런 시험이 없거나, 그 시험이 지금 그 실행 기록의 열린 티켓에 속하지 않거나, 기다림이 끝난(결과를 받았거나 취소된) 시험이면 `404 TRIAL_NOT_FOUND`다(모양이 틀린 id도 404인 것은 2번의 `DEPLOY_NOT_FOUND`와 같다). job은 읽을 때 쿼리 `?counter=<GO_PIPELINE_COUNTER>`를 꼭 붙이고(없으면 `400 BAD_REQUEST`, `fields: [{ path: "counter", code: "REQUIRED" }]`), BE는 그 값을 시험의 GoCD 인스턴스 번호로 기록한다(아래 "끝난 시험 정리"가 쓴다). 범위 안 job이 모두 읽으므로 같은 값이 여러 번 온다: 같으면 그대로 두고, 이미 기록한 값과 다르면 `400 BAD_REQUEST`다(다른 인스턴스가 같은 `trialId`를 쓰는 셈이라 생기면 안 된다). **범위 안 job은 입력 읽기를 첫 task로 둔다**(GoCD artifact 받기 다음, k3s를 부르는 task보다 먼저). 읽기가 실패하면 스테이지 CLI(`run_if: passed`)는 돌지 않고, 결과 보내기(`run_if: any`)는 돌아 `STAGE_NO_REPORT`를 보낸다. BE는 결과를 `counter`로 거르지 않는다: 그 시험이 끝났으면(읽기가 404였던 경우) `applied: false`로 버리고, 아직 기다리는 중이면(읽기가 일시적으로 실패한 경우) 받아 도구 결과(`ok: false`, `STAGE_NO_REPORT`)로 돌려준다. 어느 쪽이든 그 job은 k3s를 부르지 않았다. 이 순서가 있어야 아래 "counter가 없으면 입력을 읽은 job이 없다"가 성립한다. student-trial은 첫 스테이지가 시험마다 다르므로(Build job이 입력을 넘겨주지 않는다), Build job을 포함해 범위 안의 각 job이 `TRIAL_ID`로 입력을 직접 읽는다(시험 입력은 시험 하나 동안 바뀌지 않는다). Apply는 같은 시험의 Render artifact(`slot.yaml`)를 받는다.
- **결과**: `POST /api/pipeline/trials/:trialId/result` `{ "stage", "result" }`. 같은 `PIPELINE_NOTIFY_TOKEN`으로 인증한다. 시험 하나에 **한 번** 보낸다: 실패한 스테이지에서, 모두 통과했으면 `TRIAL_STAGES`의 마지막 스테이지에서. 파이프라인 쪽 CLI(`trial-report`)가 스테이지 결과 JSON을 바꿔 보낸다. 스테이지 결과 JSON이 없거나 모양이 틀리면 `failure.code` `STAGE_NO_REPORT`로 보낸다(3번 알림과 같다). setup · artifact 받기가 실패해 CLI 자체가 돌지 못하면 결과가 오지 않고, 게이트웨이는 30분 뒤 `TRIAL_TIMEOUT`으로 답한다. 30분 대기는 `run_build`에도 같다(CodeBuild 대기 포함). 그래서 시험 빌드의 `timeoutMinutes` 상한은 20분이고, Build CLI는 override가 있으면 빌드 대기 한도를 `timeoutMinutes` + 5분으로 둔다(없으면 지금처럼 20분). `student-trial` Build job의 GoCD 제한 시간은 30분 이상이어야 한다.
  - `stage`: 결과를 낸 스테이지(`build` · `prepare` · `render` · `apply` · `verify`).
  - `result`: 그 시험을 부른 **도구의 결과 모양 그대로**(아래 "MCP 게이트웨이 — 도구" 실행 표: `run_build` · `run_render` · `run_deploy` · `run_verify`)에 `failure` 한 칸을 더한 것이다. `failure`는 통과면 `null`, 아니면 `{ "stage", "code", "message" }`다. `code`는 플랫폼 문제면 3번과 같은 코드(`^[A-Za-z][A-Za-z0-9_]{2,63}$`), 학생 문제면 `null`이다. `message`는 3번 `failure.message`와 같은 문장이다(Verify는 통과하지 못한 검사 하나, Prepare의 쿼터 초과는 자원 합계 문장).
  - 모으는 곳: `run_build`는 Build 스테이지 리포트(`student-deploy`의 Build와 같은 CLI)로 `{ ok, reused, build, failedPhase, logTail, image }`를 만든다: `build`는 실패한 빌드의 CodeBuild 원본(3번 `raw.codebuild`와 같다, 재사용 · 성공 · 플랫폼 실패면 `null`), `failedPhase`는 실패한 phase의 `phaseType`(예 `BUILD` · `POST_BUILD`, 없으면 `null`. phase 원본은 `build`의 `phases`에 있다), `logTail`은 빌드 실패면 마지막 200줄(로그를 못 읽었으면 `[]`)이고 성공 · 재사용 · 플랫폼 실패면 `[]`(성공 때는 로그를 읽지 않는다), `image`는 통과한 digest 또는 재사용한 이미지(실패면 `null`), `reused`는 입력에서 그 서비스가 `reuse`였는지다. 빌드 실패는 `failure.code`가 `null`이고 `message`는 `buildStatus` 문장이다. `run_render`는 `render-report.json`, `run_deploy`는 `prepare-report.json` · `render-report.json` · `apply-report.json`, `run_verify`는 `verify-report.json`이다. `run_deploy`의 `services`는 입력의 서비스마다 하나다(적용 순서 AI → BE → FE). apply-report의 `ready`에 있으면 `ready: true` · `reason: null`, 실패한 서비스는 `ready: false` · `reason`은 failure 문장, 실패 뒤라 적용하지 못한 서비스는 `ready: false` · `reason: "not applied"`다. 실패면 `pods` · `events`는 그 스테이지 실패의 `raw.k8s`(3번과 같은 원본), 성공이면 `[]`다. Prepare · Render에서 실패하면 `services` · `pods` · `events`는 `[]`일 수 있고 원인은 `failure`에 있다. Render에서 학생 문제로 실패하면 k3s Status의 `message`가 `failure.message`에 들어가고 Status 원본은 싣지 않는다(`run_deploy` 결과에는 `status` 칸이 없다. 원본은 `run_render`로 본다). Apply(`run_deploy`)와 Verify(`run_verify`)는 다른 도구라 한 결과에 섞지 않는다.
  - **시험 이미지**: `run_build`가 통과하면 BE가 그 이미지를 이 티켓의 시험 이미지로 기억하고 `build_cache`에도 쓴다(같은 해시 = 같은 이미지, 3번의 build 통과 때 기록과 같은 규칙). 이후 `run_render` · `run_deploy`의 입력과 5번 다시 실행의 입력은 그 이미지를 `reuse` digest로 쓴다.
  - BE가 외부 전송 필터를 거쳐 도구 결과로 돌려준다. `failure.code`가 `LIVE_SLOT_PROTECTED`면 도구 결과 대신 같은 코드로 거절한다(에이전트가 실행을 멈춘다).
  - 응답 `200 { "ok": true }`. 모르는 id(모양이 틀린 id 포함) · 이미 결과를 받은 시험 · 기다림이 끝났거나 취소된 시험의 늦은 결과는 아무것도 바꾸지 않고 `200 { "ok": true, "applied": false }`(재전송에 안전). 오류: `401 AUTH_REQUIRED`, `400 BAD_REQUEST`(`stage`가 `TRIAL_STAGES` 밖이거나, `result`가 그 도구 모양과 다르거나, `ok: true`인데 마지막 스테이지가 아니거나 `failure`가 있거나, `ok: false`인데 `failure`가 없음. `fields` 포함). 결과는 실행 기록이 그 티켓으로 `fixing`일 때만 받는다(아니면 `applied: false`).
- **기다림**: 시험 기록과 기다림은 BE 메모리에 있다(DB에 저장하지 않는다). 그래서 BE가 다시 뜨면 기다리던 도구 호출은 연결이 끊기고(AI 서버는 게이트웨이에 닿지 못한 것으로 본다), 그 뒤 오는 결과는 `applied: false`다. BE는 **시작할 때** `student-trial`의 끝나지 않은 인스턴스를 모두 찾아(GoCD 파이프라인 이력) 진행 중인 스테이지를 GoCD API로 한 번 취소한다(취소된 스테이지 뒤는 돌지 않는다. 시험 기록이 메모리에 없어 이어 갈 수 없고, 그대로 두면 이미 입력을 읽은 옛 job과 새 시험이 같은 대상 슬롯에서 겹칠 수 있다). 그 뒤 오는 늦은 결과도 `applied: false`다. BE가 다시 뜨면 티켓 시작을 알 수 없어 저장된 토큰 만료 - 60분으로 보수적으로 잡는다: 그 티켓은 저장된 만료까지만 쓰고 더 늘리지 않는다.
- **시간**: 게이트웨이 토큰의 만료(`gateway_expires_at`)는 `min(티켓 시작 + 60분, 티켓 시작 + 15분 + 누적 시험 대기)`이다. 시험 대기를 **시작할 때** BE가 먼저 `min(티켓 시작 + 60분, 지금 + 남은 15분 예산 + 이번 시험 대기 상한)`으로 늘리고(대기 중에 같은 티켓의 다른 도구 호출이 `TICKET_CLOSED`를 받지 않게), 대기를 마칠 때 위 식으로 다시 쓴다. 티켓 전체 상한 60분은 대기를 포함하고, 넘으면 다음 호출은 `TIME_LIMIT`다. 시험 하나의 대기는 30분과 그 상한까지 남은 시간 중 짧은 쪽에서 끝난다(끝나면 `TRIAL_TIMEOUT`).
- **멈춘 실행 판정**: BE는 시험 대기를 시작할 때와 끝낼 때 실행 기록의 `updated_at`을 갱신한다. 새 배포를 시작할 때의 1시간 멈춤 판정(`POST /api/deploys/:id/start`의 `DEPLOY_IN_PROGRESS`)은 `fixing`이면서 `gateway_expires_at`이 아직 미래인 실행을 건너뛴다. 티켓 전체 상한(60분)이 지나면 `gateway_expires_at`도 지나므로, 그런 실행도 그 뒤에는 평소대로 판정된다(끝이 늘 있다).
- **끝난 시험 정리**: `TRIAL_TIMEOUT` · `TIME_LIMIT` · 티켓 종료(결과 제출 · 종료 알림 · 만료) 때 결과가 아직 없는 시험이 있으면 BE가 그 `student-trial` 인스턴스(기록한 `counter`)를 읽어 진행 중인(또는 배정을 기다리는) 스테이지를 GoCD API로 한 번 취소한다(주기 조회가 아니다. GoCD의 취소 단위는 스테이지이고, 취소된 스테이지 뒤는 돌지 않는다. 정확한 경로 · 헤더는 구현 때 GoCD 26.1 문서로 확인한다). `counter`가 아직 없으면 그 인스턴스는 입력을 읽은 job이 없다: 나중에 입력을 읽으면 404라 슬롯을 건드리지 않고 끝난다.
- **순서**: 다음 시험과 `verified` 뒤 다시 실행(5번)은 같은 프로젝트의 이전 시험 인스턴스가 끝났음(결과 도착, 취소 성공, 또는 입력을 읽은 job이 없음)을 확인한 뒤에만 schedule한다. 확인하지 못하면 다음 시험은 `ok: false`와 `failure: { "stage": null, "code": "TRIAL_STILL_RUNNING", "message" }`로 답한다. 다시 실행은 잠시 기다렸다 한 번 더 확인하고, 그래도 못 하면 `failed`(플랫폼 문제 `TRIAL_STILL_RUNNING`)로 마감한다. 시험이 지우는 것은 대상 슬롯뿐이라(Prepare의 슬롯 비우기) 늦게 끝나는 시험도 공개 주소에는 영향이 없다. 취소가 Apply 도중이면 대상 슬롯이 반쯤 적용된 채 남지만, 다음 `run_deploy` · 다시 실행의 Prepare가 그 슬롯을 비우고 시작한다(`run_render` · `run_verify`에는 Prepare가 없어, 그 사이 `run_verify`는 반쯤 적용된 상태를 그대로 실패로 본다). 취소된 시험 빌드는 CodeBuild 빌드가 끝까지 돌 수 있지만 이미지를 쓰는 곳이 없어 영향이 없다(결과는 `applied: false`).

**5. `verified` 뒤 다시 실행**: 에이전트가 `verified`를 내면 플랫폼이 **고친 입력으로 `student-deploy`를 처음부터 다시 실행**한다. 전환 전용 파이프라인은 두지 않고 1~3번의 모양은 그대로다. 결정은 [ADR-014](../adr/014-agent-trial-pipeline-and-rerun.md)다. BE는 아래를 구현했다(B2, `BE/src/gateway/tools.ts` `submitVerified` · `BE/src/deploys/deploy-runs.service.ts`). 빌드 경로 `specPatch`는 B3에서 받는다: 그 서비스의 이미지는 이 티켓의 `run_build`가 통과(또는 #149의 재사용)한 이미지다. 흐름은 4번 첫머리 그림과 같다: 공개 주소가 바뀌는 곳은 이 다시 실행의 Switch뿐이다.

- **받는 조건**(게이트웨이 `submit_result`): `specPatch`의 경로 검사(`PATCH_FORBIDDEN`)와 적용한 spec의 검증(`INVALID_SPEC`)을 `run_deploy` 때와 같은 함수로 하고, 이 티켓에서 **같은 `specPatch`로 성공한 `run_deploy`와 그 뒤 통과한 `run_verify`**가 있어야 한다(재실행만 했으면 빈 `specPatch`로 성공한 `run_deploy`). `specPatch`에 빌드 경로가 있으면 **같은 패치로 통과한 `run_build`**도 있어야 한다(빌드 값을 고친 서비스마다, 같은 빌드 입력 해시로 이 티켓의 `run_build`가 통과했거나 #149로 재사용했어야 한다. `build_cache`에 이미지가 있어 `run_deploy`가 통과했어도 `run_build`를 한 번 불러야 한다). 없으면 `INVALID_RESULT`. 같은지는 패치를 적용한 시험 입력을 비교해 본다. 그 `run_deploy` 뒤에 `run_deploy`를 또 불렀으면(성공 · 실패 모두 대상 슬롯을 다시 올린다) 앞 확인은 쓰지 않고, `run_verify`가 실행 기록의 입력(`run_deploy` 없이)을 확인한 것도 세지 않는다. `specPatch`는 `verified`에 꼭 있어야 한다(배열). `buildOverrides`는 기록용이다(그 빌드는 이미 통과했다): 객체인지만 보고 저장하지 않는다.
- **저장**: 패치한 spec을 실행 기록의 `input`에 저장한다. `deploy_condition.services`는 모두 `reuse` + 이미지 digest로 바꿔 저장한다. 이미지는 4번 `run_deploy` 입력과 같은 규칙(같은 해시의 실행 기록 이미지 · 이 티켓의 시험 이미지 · `build_cache`)으로 고르며, 받는 조건을 통과했으면 모든 서비스에 이미지가 있다. 학생이 저장한 배포 입력(`deploys.spec`)은 바꾸지 않는다: 학생이 확정한 값이고, 고친 내용은 진행 상태의 `agent`(결과 요약)로 보여 준다. 고친 spec을 학생의 다음 커밋 배포로 이어 주는 것은 범위 밖이다.
- **다시 실행**: 같은 실행 기록을 `fixing → running`, `stage: build`로 되돌리고 `failure`를 비우고 게이트웨이 토큰을 무효로 한 뒤(`ticket_id`는 종료 알림을 보낼 때까지 남긴다), 1번과 똑같이 `DEPLOY_ID`로 `student-deploy`를 schedule한다. 대상 슬롯은 그 실행 기록의 대상 슬롯 그대로다. 입력은 2번으로 읽어 가므로 고친 입력이 간다. Build는 모든 서비스가 `reuse`라 할 일이 없고(`images`는 `{}`), 그 뒤 Prepare → Render → Apply → Verify → Switch와 W7 · `succeeded`는 3번 상태 기계 그대로다. 다시 실행의 Verify가 대상 슬롯 재확인이다. schedule이 실패하면 `failed`(`PIPELINE_UNAVAILABLE`)로 마감한다.
- **순서**: 기다리는 시험이 있으면 먼저 취소하고(티켓 종료), 4번 "순서"대로 이전 시험이 끝났음을 확인한 뒤에 schedule한다. 확인하지 못하면 잠시(3초) 기다렸다 한 번 더 보고, 그래도 못 하면 실행 기록을 `failed`(`TRIAL_STILL_RUNNING`, 실패한 티켓의 `stage`)로 마감하고 `close(stopped)`를 보낸다. 해결 결과는 이때도 `agent_result`에 남는다.
- **종료 알림**: `succeeded`가 되면 그 티켓에 `close(success)`, 다시 실행이 플랫폼 문제로 `failed`가 되거나(schedule 실패 포함) 다시 실행 중(`running`) 멈춰 `TIMED_OUT`이 되면 `close(stopped)`를 보낸다.
- **다시 실패하면**: 평소대로 새 티켓을 만든다(이전 티켓은 `close(superseded)`, 새 티켓의 `previous`는 이전 티켓의 id · `verified` · 요약). 티켓은 **실행 기록당 3개까지**다. 네 번째 티켓이 될 실패는 티켓을 만들지 않고 `failed`(`AGENT_GAVE_UP`)로 마감하고 앞 티켓에 `close(stopped)`를 보낸다. 횟수는 칸을 더하지 않고 `deploy_runs.agent_result.tickets`(그 결과가 몇 번째 티켓의 것인지, 1부터)에 센다: 첫 티켓 뒤의 새 티켓은 `verified` 뒤 다시 실행이 실패할 때만 나오고, 그때 `agent_result`는 앞 티켓의 결과이기 때문이다. 진행 상태의 `agent`에는 이 칸이 없다.
- **알려진 한계 — 알림 세대**: 다시 실행은 같은 `deployId`로 돌므로 1~3번 알림만으로는 첫 실행과 다시 실행의 알림을 구분하지 못한다. 실제 위험은 좁다: 파이프라인의 알림 재시도는 1 · 2 · 4초 간격(첫 시도 포함 4번, 호출당 10초)이라 늦어도 1분 안에 끝나고, 첫 실행이 실패한 뒤 실행 기록은 `fixing`이라 그동안 오는 알림은 `applied: false`이며, 다시 실행은 시험 뒤(수 분 뒤)에 시작한다. 남는 경우는 운영자가 GoCD에서 옛 인스턴스의 스테이지를 손으로 다시 돌릴 때뿐이다. 필요하면 알림에 `GO_PIPELINE_COUNTER`를 더해 지금 세대만 받는다(후속, 1~3번 모양과 파이프라인 알림 task가 바뀐다).

## 운영자 API (이슈 #100, UC-17)

운영자가 Admin Page에서 클러스터 자원과 실행 중인 학생 서비스를 보고, 서비스를 강제로 끈다(FR-083 · FR-084 · FR-094). 플랫폼 서버가 Tailscale로 리더의 쿠버네티스 API에 붙어 읽고 쓴다([`cluster.md`](cluster.md) §8).

**공통**

- 모두 로그인 토큰이 필요하고, `isAdmin`(`app_metadata.role === 'admin'`, [`auth.md`](auth.md))일 때만 받는다. 아니면 `403 ADMIN_REQUIRED`다. 운영자 계정은 하나다.
- 리더의 쿠버네티스 API에 닿지 못하면(시간 초과 · 인증서 검증 실패 · 설정 없음) `503 CLUSTER_UNREACHABLE`, 닿았는데 서버 계정에 그 일의 권한이 없으면(401 · 403) `503 CLUSTER_FORBIDDEN`이다. 화면은 앞의 것을 "리더 무응답"으로 보여 준다([`cluster.md`](cluster.md) §10). `503 DATABASE_UNAVAILABLE`도 있다.
- **노드 사용량은 `metrics.k8s.io`로 읽는다**(`GET /apis/metrics.k8s.io/v1beta1/nodes`, 권한 [`cluster.md`](cluster.md) §8, #130). 읽으면 노드의 `usage`가 `{ "cpuMillicores", "memoryBytes" }`로 채워지고 응답의 `usageStatus`는 `"collected"`다. 사용량을 읽지 못하면(권한 · 시간 초과 · 그 API가 없음) 노드 목록은 그대로 주고 모든 노드의 `usage`가 `null`, `usageStatus`가 `"not_collected"`다(오류로 답하지 않는다: 노드 목록 읽기가 실패해야만 `503`이다). 읽었는데 어떤 노드가 그 목록에 없으면(첫 수집 전, 수십 초) 그 노드만 `usage: null`이다. 값을 지어내지 않는다. Pod 사용량은 이 API에 싣지 않는다.

### `GET /api/admin/nodes` — 노드 현황

응답 `200`:

```json
{
  "usageStatus": "collected",
  "nodes": [
    {
      "name": "leader",
      "ready": true,
      "role": "leader",
      "cpu": { "capacityMillicores": 4000, "allocatableMillicores": 3900 },
      "memory": { "capacityBytes": 16777216000, "allocatableBytes": 16000000000 },
      "disk": { "capacityBytes": 250000000000, "allocatableBytes": 230000000000 },
      "usage": { "cpuMillicores": 123, "memoryBytes": 7002152960 }
    }
  ]
}
```

- `role`: 컨트롤 플레인 라벨(`node-role.kubernetes.io/control-plane` · `master`)이 있으면 `leader`, 아니면 `worker`.
- `ready`: 노드의 `Ready` 조건이 `True`일 때만 `true`.
- 수량은 모두 정수다(CPU는 밀리코어, 메모리 · 디스크는 바이트). 읽을 수 없는 칸은 `null`.

### `GET /api/admin/projects` — 실행 중인 서비스

DB에 배포가 있는 프로젝트(`slug`)마다 공간 `proj-<slug>`를 읽어 돌려준다(공간 전체를 한 번에 읽는 권한은 서버 계정에 없다). 가장 최근에 배포를 저장한 프로젝트부터. 공간이 아직 없으면 `services`가 `[]`다. 한 프로젝트의 공간만 못 읽으면(권한 · 시간 초과) 나머지는 그대로 돌려주고 그 프로젝트는 `services: []`에 `clusterError`(`CLUSTER_FORBIDDEN` · `CLUSTER_UNREACHABLE`)를 단다. 모든 프로젝트를 못 읽으면 `503`이다. DB에서 한 번에 읽는 배포는 최근 500개라 그보다 오래된 프로젝트는 빠진다(MVP 규모에서는 넘지 않는다).

응답 `200`:

```json
{
  "projects": [
    {
      "slug": "my-app",
      "repo": "student/my-app",
      "ownerId": "11111111-1111-4111-8111-111111111111",
      "liveSlot": "a",
      "url": "https://my-app.stairnoworks.com",
      "lastStop": { "at": "2026-11-11T01:00:00.000Z", "by": "operator@example.com" },
      "clusterError": null,
      "usageStatus": "collected",
      "services": [
        {
          "name": "fe-a", "slot": "a", "replicas": 1, "readyReplicas": 1,
          "restarts": 0,
          "usage": { "cpuMillicores": 40, "memoryBytes": 73400320 },
          "pods": [{ "name": "fe-a-6d9f-xk2", "phase": "Running", "ready": true, "node": "worker-1", "restarts": 0 }]
        }
      ]
    }
  ]
}
```

- `services[]`는 공간의 Deployment 하나(`<서비스>-<슬롯>`)다. `slot`은 이름 끝의 `a` · `b`(아니면 `null`). `replicas`는 원하는 개수(`spec.replicas`), `readyReplicas`는 준비된 개수.
- `restarts`: 그 서비스 Pod들의 컨테이너 재시작 횟수의 합(`pods[].restarts`의 합. 지금 떠 있는 Pod의 값이라 Pod가 새로 뜨면 0으로 돌아간다).
- `usage`: 그 서비스 Pod들의 실제 사용량의 합 `{ "cpuMillicores", "memoryBytes" }`(정수, 밀리코어 · 바이트). `metrics.k8s.io`의 Pod 사용량(`GET /apis/metrics.k8s.io/v1beta1/namespaces/proj-<slug>/pods`)을 읽는다. Pod가 없거나(replicas 0 포함), 그 서비스의 Pod가 하나도 목록에 없으면(첫 수집 전, 수십 초) `null`이다. 일부 Pod만 목록에 있으면 있는 것의 합이다(새로 뜬 Pod는 수십 초 늦게 들어온다). 값을 지어내지 않는다.
- `usageStatus`(프로젝트마다): `"collected"` 또는 `"not_collected"`. 그 프로젝트의 Pod 사용량을 읽지 못하면(권한 · 시간 초과 · 그 API가 없음) `"not_collected"`이고 그 프로젝트의 모든 서비스의 `usage`가 `null`이다(오류로 답하지 않는다. 공간을 읽지 못한 `clusterError`와 별개다). 노드의 `usageStatus`와 같은 방식이다.
- `liveSlot` · `url`: 아직 한 번도 전환하지 않았으면 `null`.
- `lastStop`: 가장 최근 강제 중지 기록(없으면 `null`). 그 뒤에 다시 배포했는지는 `replicas`로 본다.
- `ownerId`: 소유자의 사용자 id(이메일은 배포 테이블에 없다).

### `POST /api/admin/projects/:slug/stop` — 강제 중지 (FR-094)

공간 `proj-<slug>`의 모든 Deployment를 `replicas: 0`으로 내린다. 공개 주소는 응답할 Pod가 없어 더는 응답하지 않는다(Ingress는 그대로 둔다). 다시 켜기는 MVP 밖이고, 학생이 새로 배포하면 다시 뜬다. 요청 본문은 없다.

응답 `200`: `{ "slug", "scaled": ["fe-a", "be-a"], "failed": [] }`. 하나라도 내렸으면 누가 언제 했는지 기록한다(`admin_actions`. 하나도 못 내렸으면 기록하지 않는다. 기록하지 못하면 `503 DATABASE_UNAVAILABLE`이고, 이미 내린 것은 그대로지만 같은 요청을 다시 보내도 안전하다). 일부만 실패해도 `200`이고 `failed`에 이름이 온다(다시 요청하면 이어서 내린다).

오류: `404 PROJECT_NOT_FOUND`(DB에 없는 slug, slug 모양이 아닌 값 포함), `409 NOT_RUNNING`(공간이 없거나 Deployment가 없다), `403 ADMIN_REQUIRED`, `503 CLUSTER_UNREACHABLE`, `503 CLUSTER_FORBIDDEN`(서버 계정이 scale을 거절당했을 때: 권한 없음 403, 검사 규칙 거절 422. scale 권한은 2026-11-11에 들어갔다([`cluster.md`](cluster.md) §8, 0 · 1과 재시작만). 일부만 내리고 나머지가 실패하면 오류가 아니라 `failed`에 담긴다), `503 DATABASE_UNAVAILABLE`.

## AI 에이전트 (플랫폼 서버 ↔ AI 서버)

배포 실패를 고치는 AI 에이전트와 플랫폼 서버가 주고받는 약속이다. 흐름 · 티켓 · 결과의 뜻은 [AI 에이전트 설계](AIagent.md), 언제 부르는지는 [배포 워크플로우](deploy-workflow.md) §6에 있다. 두 서버는 같은 EC2의 컨테이너이고, 이 API는 **컨테이너 사이 내부 망에서만** 열고 공개 주소(`/api`)에 붙이지 않는다. 로그인 토큰(사용자)이 아니라 아래 서버 사이 토큰을 쓴다.

| 방향 | 무엇 | 어디 |
| --- | --- | --- |
| 플랫폼 → AI | 티켓 접수, 종료 알림 | AI 서버 `POST /agent/tickets` · `POST /agent/tickets/{ticketId}/close` |
| AI → 플랫폼 | 도구 호출, 해결 결과 제출 | 플랫폼 서버 MCP 게이트웨이 (Streamable HTTP), 결과는 도구 `submit_result` |

**토큰**

| 토큰 | 누가 만드나 | 어디에 쓰나 | 범위 |
| --- | --- | --- | --- |
| `AGENT_API_TOKEN` | 운영자가 두 서버의 env에 같은 값으로 넣는다 | 플랫폼 → AI 요청의 `Authorization: Bearer` | 고정. 비밀값이라 로그 · 응답에 남기지 않는다 |
| 게이트웨이 토큰 | 플랫폼 서버가 티켓마다 무작위로 만든다 | AI → 게이트웨이 요청의 `Authorization: Bearer` | 그 티켓 하나. 종료 알림을 보내거나, 해결 결과를 받거나, 15분(파이프라인 대기 제외)이 지나면 무효 |

게이트웨이 토큰이 티켓을 가리키므로 도구에는 `ticketId` 인자가 없다. 게이트웨이 주소는 AI 서버 env(`GATEWAY_URL`)로 고정하고, 요청 본문으로 받지 않는다(AI 서버가 받은 주소로 토큰을 보내지 않게).

### `POST /agent/tickets` — 문제 티켓 접수 (AI 서버)

요청:

```json
{
  "ticket": { "ticketId": "t_0013", "commitSha": "…", "stage": "apply", "service": "be", "targetSlot": "b", "deployInput": {}, "errorMessage": "…", "raw": { "codebuild": null, "k8s": { "pod": {}, "events": [], "status": null } }, "logs": { "from": "…", "to": "…", "lines": [] }, "previous": null },
  "gateway": { "token": "gw_…", "expiresAt": "2026-11-10T13:27:00Z" }
}
```

- `ticket`: [AI 에이전트 설계](AIagent.md) §5의 티켓 그대로. 플랫폼이 실패 알림을 받은 순간의 스냅샷이고, 외부 전송 필터를 거친 값이다.
- `ticket.raw`: stage에 따라 두 모양만 받는다. `build`면 `{ "codebuild": <BatchGetBuilds builds[0] 원본>, "k8s": null }`, 그 밖의 stage면 `{ "codebuild": null, "k8s": { "pod": <Pod 원본> | null, "events": [<Event 원본>], "status": <k3s Status 원본> | null } }`. `status`는 `render`일 때 dry-run이 돌려준 Status(필수)이고 그 밖에는 `null`이다. `render`면 `errorMessage`에 Status의 `message`를 그대로 넣는다.
- `ticket.previous.status`: `verified` · `pr_opened` · `needs_user` · `gave_up`(그 티켓의 해결 결과) · `stopped`(결과 없이 끝남) 중 하나.
- `gateway.token`: 이 티켓에만 쓰는 게이트웨이 토큰.
- AI 서버는 받은 로그(한 줄 400자, 전체 24KB)와 큰 원본(`raw.*`, 게이트웨이 도구 결과의 Pod · 이벤트 · builds[0] · Status)을 받는 쪽에서 직접 줄여 모델에 준다([AI 에이전트 설계](AIagent.md) §10). 플랫폼은 원본을 그대로 보내면 된다.

응답 `202`: `{ "ticketId": "t_0013" }`. 에이전트 실행은 응답 뒤에 시작한다(플랫폼은 끝날 때까지 기다리지 않는다). 같은 `ticketId`를 다시 보내면 새로 시작하지 않고 같은 `202`를 준다(재전송용).

오류: `401 AUTH_REQUIRED`(토큰 없음 · 틀림), `400 BAD_REQUEST`(본문이 JSON 객체가 아님), `400 INVALID_TICKET`(모양이 §5와 다름), `503 AGENT_BUSY`(동시에 도는 에이전트 수가 AI 서버 env `AGENT_MAX_RUNS`(기본 2)에 닿음. 플랫폼은 잠시 뒤 다시 보낸다. 이미 받은 `ticketId`의 재전송은 바빠도 `202`).

`INVALID_TICKET`의 `fields`는 `POST /api/deploys`의 `INVALID_SPEC`과 같은 모양(칸마다 `code` 하나, 최대 20칸)이고, `path`는 **요청 본문 기준**이다: `ticket.stage`, `ticket.raw.k8s.events[0]`, `gateway.expiresAt`. stage와 `raw`가 맞지 않으면 고칠 칸을 `REQUIRED` · `MUST_BE_NULL`로 알려 준다(예: stage `build`인데 `raw.k8s`가 있으면 `ticket.raw.k8s` `MUST_BE_NULL`).

### `POST /agent/tickets/{ticketId}/close` — 종료 알림 (AI 서버)

요청: [AI 에이전트 설계](AIagent.md) §7 그대로 `{ "ticketId", "commitSha", "reason": "success" | "superseded" | "stopped" }`.

응답 `204`. 실행 중이면 멈추고, `success`면 그 티켓에 쓴 case의 `stats.solved`를 올린다. 모르는 `ticketId`도 `204`다(이미 끝난 티켓의 재전송).

오류: `401 AUTH_REQUIRED`, `400 BAD_REQUEST`(본문이 JSON 객체가 아님), `400 INVALID_CLOSE`(모양이 §7과 다름. `fields`는 위와 같은 모양이고 `path`는 본문 기준. 본문 `ticketId`가 URL의 `ticketId`와 다르면 `fields: [{ "path": "ticketId", "code": "MISMATCH" }]`).

### MCP 게이트웨이 — 도구 (플랫폼 서버)

- 전송: MCP Streamable HTTP, 플랫폼 서버의 내부 포트(`GATEWAY_PORT`, 공개 포트와 다르다) `POST /mcp`. 상태 없는 서버라 세션 스트림(`GET`) · 세션 끝내기(`DELETE`)는 `405`다. AI 서버의 `GATEWAY_URL`은 `http://<플랫폼 서버>:<GATEWAY_PORT>/mcp`이고, `GATEWAY_PORT`가 비어 있으면 게이트웨이를 열지 않는다.
- **지금 여는 도구(F11 · F11b)**: `get_target_status` · `read_pod_logs` · `read_repo` · `run_build` · `run_render` · `run_deploy` · `run_verify` · `submit_result`다. 대상 슬롯 운영 · `read_build_logs`는 그 뒤에, `edit_repo_file` · `open_pr`은 F13에서 연다. 목록에 없는 도구를 부르면 `INVALID_ARGUMENT`다. `read_repo`의 `source`도 그때까지 `INVALID_ARGUMENT`다.
- **시험 도구(F11b)**: `run_build` · `run_render` · `run_deploy` · `run_verify`는 위 "파이프라인 ↔ 플랫폼 서버" 4번 시험 실행으로 돈다. `specPatch`는 `build` · `runtime` 경로를 받고, `name` · `slug` 경로는 `PATCH_FORBIDDEN`이다(슬롯 · Secret 이름이 서비스 이름을 따라 바뀌어 대상 슬롯에서 시험할 수 없다). 빌드 값을 고친 서비스의 이미지가 없으면(아직 `run_build`를 통과하지 않음) `run_render` · `run_deploy`는 `INVALID_ARGUMENT`("먼저 `run_build`")다. `build` 스테이지 티켓도 `run_build`로 고쳐 본다. `source`는 F13까지 `INVALID_ARGUMENT`다. 티켓마다 시험은 한 번에 하나다(겹치면 `INVALID_ARGUMENT`). 도구별 횟수는 `run_build` 2 · `run_render` 5 · `run_deploy` 2 · `run_verify` 3이다. `buildOverrides` 상한은 `computeType` `BUILD_GENERAL1_SMALL` · `MEDIUM`(프로젝트 기본 SMALL보다 한 단계 위까지. MEDIUM은 무료 티어 밖이다), `timeoutMinutes` 1~20, `image` `aws/codebuild/amazonlinux-x86_64-standard:5.0`(프로젝트와 같은 이미지. privileged 모드에서 docker가 돈다)이고, 밖이면 `OVERRIDE_LIMIT`, 모르는 칸이나 틀린 타입이면 `INVALID_ARGUMENT`다. 대상 슬롯 운영 · `read_build_logs`는 그 뒤에 연다.
- **`verified`(B2)**: 받는 조건과 그 뒤 처리는 위 "파이프라인 ↔ 플랫폼 서버" 5번이다. 받으면 실행 기록이 `running`(다시 실행)이 된다. `specPatch` · `buildOverrides`는 `verified`에만 쓰고, 다른 status에 있으면 `INVALID_RESULT`다. 받은 결과로 실행 기록은 `gave_up`이면 `failed`(`AGENT_GAVE_UP`), `pr_opened` · `needs_user`면 `needs_user`가 된다. 결과의 `status` · `summary` · `userRequest` · `pr` · `evidence` · `classification`만 `deploy_runs.agent_result`에 저장하고(`actions`는 버린다), 진행 상태 응답의 `agent`로 보여 준다.
- 도구 목록 · 하는 일 · 티켓당 횟수는 [AI 에이전트 설계](AIagent.md) §3이다. 여기는 인자와 결과의 모양만 고정한다. `read_memory`는 AI 서버 안의 도구라 게이트웨이에 없다(case와 통계를 AI 서버가 갖는다).
- 결과는 MCP 도구 결과의 `structuredContent`에 아래 JSON으로 담는다. 실행이 실패해도(빌드 실패, Ready 안 됨) 도구 호출은 성공이고 `ok: false`다. 게이트웨이가 거절한 호출만 `isError: true`이고 `structuredContent`는 `{ "code", "message" }`다.
- `run_*` · `wait_target_ready`는 파이프라인이 끝날 때까지 기다렸다가 답한다(최대 30분). AI 서버의 MCP 클라이언트는 호출 제한 시간을 35분으로 둔다. 30분과 티켓 전체 상한(60분)까지 남은 시간 중 짧은 쪽 안에 결과가 오지 않으면(위 4번 "시간") `ok: false`와 `failure: { "stage": null, "code": "TRIAL_TIMEOUT", "message" }`로 답한다. 기다린 시간은 에이전트 작업 15분과 게이트웨이 토큰 유효 시간에서 뺀다.
- `run_render` · `run_deploy` · `run_verify`의 결과에는 아래 표의 칸 말고 `failure`(`null` 또는 `{ stage, code, message }`, 위 4번)가 늘 있다.
- `specPatch`는 JSON Patch(RFC 6902) 배열이고 경로 규칙은 §6과 같다. 그 실행에만 적용한다.
- `source`는 `{ "commitSha": "<봇 fork의 40자 SHA>" }`이고 `edit_repo_file`이 돌려준 값만 받는다.
- 로그 · 원본은 외부 전송 필터를 거친 값이다. 원본 k3s 객체에서 `metadata.managedFields`와 적용 기록 annotation은 뺀다.

**실행**

| 도구 | 인자 | 결과 `structuredContent` |
| --- | --- | --- |
| `run_build` | `service`, `specPatch?`, `source?`, `buildOverrides?` (`{ computeType?, timeoutMinutes?, image?, cache? }`) | `{ ok, reused, build: <BatchGetBuilds builds[0] 원본> \| null, failedPhase: string \| null (실패한 phase의 phaseType), logTail: string[] (최대 200줄), image: string \| null }` |
| `run_render` | `specPatch?` | `{ ok, status: <k3s Status 원본> \| null }` |
| `run_deploy` | `specPatch?`, `source?` | `{ ok, services: [{ service, ready, reason: string \| null }], pods: [<Pod 원본>], events: [<Event 원본>] }` |
| `run_verify` | 없음 | `{ ok, ready: [{ service, ready }], requests: [{ service, path, status: number \| null, ms: number \| null, error: string \| null }] }` |

**관찰**

| 도구 | 인자 | 결과 |
| --- | --- | --- |
| `get_target_status` | `service?` (없으면 대상 슬롯 전체) | `{ pods: [<Pod 원본>], events: [<Event 원본>], rollouts: [{ service, ready, updated, available }] }` |
| `read_pod_logs` | `service`, `lines?` (1~200, 기본 100), `previous?` (기본 `false`) | `{ lines: string[] }` |
| `read_build_logs` | `service`, `fromLine?` (기본 마지막 200줄), `lines?` (1~200) | `{ fromLine, lines: string[] }` |
| `read_repo` | `path` (레포 안 상대 경로, `.`은 루트), `source?` (없으면 티켓의 `commitSha`) | 폴더: `{ type: "dir", entries: [{ name, type: "file" \| "dir", size }] }`, 파일: `{ type: "file", content, truncated }` (200KB 넘으면 자름) |

**대상 슬롯 운영**

| 도구 | 인자 | 결과 |
| --- | --- | --- |
| `restart_target` | `service` | `{ ok }` |
| `scale_target` | `service`, `replicas` (`0` \| `1`) | `{ ok }` |
| `wait_target_ready` | `service`, `timeoutSeconds?` (1~420, 기본 300) | `{ ok, pods: [<Pod 원본>], events: [<Event 원본>] }` |

**레포 수정 · 끝내기**

| 도구 | 인자 | 결과 |
| --- | --- | --- |
| `edit_repo_file` | `files: [{ path, content }]` (한 번에 바꿀 파일 전체 내용), `message` (commit 메시지) | `{ source: { commitSha }, files: string[], changedLines }` |
| `open_pr` | `source`, `title`, `body` | `{ url }` \| fork가 막혔으면 `{ url: null, patch }` |
| `submit_result` | `result` ([AI 에이전트 설계](AIagent.md) §6 그대로) | `{ accepted: true }`. 이 호출 뒤 게이트웨이 토큰은 무효다 |

**게이트웨이가 거절할 때의 `code`**

| `code` | 뜻 |
| --- | --- |
| `INVALID_ARGUMENT` | 인자 모양이 틀림 (모르는 서비스 이름 포함) |
| `TOOL_LIMIT` | 그 도구의 티켓당 횟수 또는 전체 20회를 넘음 |
| `TIME_LIMIT` | 에이전트 작업 15분(파이프라인 대기 제외)을 넘음, 또는 티켓 전체 60분(대기 포함) 상한을 넘음 |
| `REPEATED_CALL` | 같은 도구 · 같은 인자를 연속 세 번째로 부름 |
| `PATCH_FORBIDDEN` | `specPatch` 경로가 `build` · `runtime` 밖이거나, `name` · `slug`를 고침(대상 슬롯에서 시험할 수 없다), 또는 live에서 `stripPrefix: true`인 서비스의 `ingressPath`를 고침 |
| `INVALID_SPEC` | 패치를 적용한 spec이 배포 입력 검증 규칙을 어김 (`fields` 포함) |
| `OVERRIDE_LIMIT` | `buildOverrides`가 상한 밖 |
| `LIVE_SLOT_PROTECTED` | 대상 슬롯이 live 슬롯과 같아 보여 중단함 (플랫폼 문제로도 보고된다) |
| `EDIT_FORBIDDEN` | 금지 파일(`.env` · `.github/`), 파일 5개 · 50줄 초과, 비밀값처럼 보이는 문자열 |
| `NOT_VERIFIED` | `open_pr`의 `source`로 `run_verify`를 통과한 적이 없음 |
| `INVALID_RESULT` | `submit_result`의 `result`가 §6 스키마와 다르거나 `commitSha`가 티켓과 다름 |
| `TICKET_CLOSED` | 토큰이 무효 (종료 알림 · 결과 제출 · 시간 초과 뒤) |

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
