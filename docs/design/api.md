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

**`spec` 검증 규칙.** 모르는 키는 거부한다(오타가 조용히 저장되지 않게). `400 INVALID_SPEC`은 어긋난 칸을 **칸마다** 알려 준다. 오류 응답의 `error`에 선택 필드 `fields`가 더해진다(다른 오류에는 없다):

```json
{
  "error": {
    "code": "INVALID_SPEC",
    "message": "spec has 2 invalid fields (first: services[1].runtime.port)",
    "fields": [
      { "path": "services[1].runtime.port", "code": "OUT_OF_RANGE" },
      { "path": "services[0].build.install", "code": "REQUIRED" }
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
| `DUPLICATE` | 서로 달라야 하는 값이 같다 (`services[].name`, `secretKeys`, `links[].env`) |
| `UNKNOWN_KEY` | 모르는 키다 |
| `UNKNOWN_SERVICE` | `links[].service`가 `spec.services`에 없는 이름이다 |
| `RESERVED` | 예약된 이름이다 (`project.slug`) |
| `CONFLICT` | 칸 사이가 맞지 않는다 (`buildEnv`의 키가 `secretKeys`와 겹침, 정적인데 `port`가 8080이 아님, `env` · `secretKeys` · `links`가 비어 있지 않음) |
| `MISMATCH` | 확인한 레포와 다르다 (`project.repo`) |

FE가 select에 넣을 허용 값: `role` = `fe` · `be` · `ai`, `runtime.kind` = `server` · `static`, `build.framework` = `vite-react` · `nextjs` · `nest`(또는 `null`), `runtime.health.type` = `http` · `tcp`. `build.nodeVersion`은 서버가 `22` · `22.1` · `22.1.0` 모양만 받고 **변환하지 않는다**(초안의 `engines.node` 원문 `>=22`는 받지 않는다. FE가 `22` 같은 값을 미리 채워 두거나 사용자가 고르게 한다). 초안(`deploy-spec`의 `projects[]`)을 입력(`spec.services[]`)으로 옮기는 것도 이번에는 FE가 한다(초안이 모르는 칸은 사용자가 채운다). 서버는 `spec` 하나를 받아 검증할 뿐이다.

| 칸 | 규칙 |
| --- | --- |
| `project.slug` | 소문자 영숫자와 `-`, 영숫자로 시작하고 끝남, 1~58자(`proj-` 접두사를 붙여도 DNS 이름 한도 63자). 예약 이름 불가(초기 목록: `www` · `api` · `admin` · `app` · `platform` · `default` · `kube-system`. 인프라 담당 확인 전 임시) |
| `project.repo` | `owner/name` |
| `services` | 1~3개. `name`은 서비스 사이에서 유일 |
| `services[].name` | 소문자로 시작하는 소문자 영숫자와 `-`, 영숫자로 끝남, 1~52자(시험 배포의 `-candidate`를 붙여도 63자 이내). Deployment · Service 이름이자 클러스터 안 DNS 이름 |
| `role` | `fe` · `be` · `ai` |
| `dir` · `build.context` · `build.dockerfile` · `build.outputDir` | 레포 안 상대 경로(`.` 가능, `/`로 시작 · `..` · `\` 불가). `dockerfile` · `outputDir`은 `null` 가능 |
| `build.framework` | `null` · `vite-react` · `nextjs` · `nest` |
| `build.nodeVersion` | `null` 또는 `22` · `22.1` · `22.1.0` 모양 |
| `build.install` · `build` · `start` | `null` 또는 비어 있지 않은 한 줄 문자열(1000자 이하) |
| `build.buildEnv` · `runtime.env` | 키는 `[A-Za-z_][A-Za-z0-9_]*`, 값은 문자열 |
| `runtime.kind` | `server` · `static` |
| `runtime.port` | 1~65535 정수 |
| `runtime.health` | `type`이 `http`면 `path`는 `/`로 시작하는 문자열, `tcp`면 `path`는 `null`. `startupTimeoutSeconds`는 1~600 정수 |
| `runtime.secretKeys` | env 이름 배열(중복 불가). 값은 저장하지 않는다(W3이 Secret으로 따로 넣는다) |
| `runtime.links` | `{ env, service }` 배열. `env`는 env 이름이고 `service`는 `spec.services`에 있는 `name` |
| `runtime.ingressPath` | `null`(내부 전용) 또는 `/`로 시작하는 문자열 |
| `runtime.stripPrefix` | 불리언 |
| `runtime.resources` | 지금은 `null`만 받는다(모양이 정해지면 추가) |

칸 사이의 규칙:

- `build.dockerfile`이 있으면 `framework` · `nodeVersion` · `install` · `build` · `start` · `outputDir`은 모두 `null`
- `build.dockerfile`이 `null`이면 `framework` · `nodeVersion` · `install` · `build`가 필수, `kind: server`면 `start` 필수 · `outputDir`은 `null`, `kind: static`이면 `outputDir` 필수 · `start`는 `null`
- `kind: static`이면 `port`는 8080, `env` · `secretKeys` · `links`는 비어 있음
- `buildEnv`의 키와 `secretKeys`는 겹칠 수 없다(`buildEnv`는 번들에 박히는 공개 값이다)

오류 (`code`: 의미):

- `400 INVALID_REPO_URL` · `400 INVALID_COMMIT` · `400 INVALID_SPEC`: 위 1 · 4번. `INVALID_SPEC`에는 `fields`가 있다
- `401 AUTH_REQUIRED` · `401 INVALID_TOKEN`: 로그인 토큰 문제
- `403 GITHUB_NOT_LINKED` · `403 REPO_NOT_OWNED` · `404 REPO_NOT_FOUND` · `422 REPO_NOT_PERSONAL`: `POST /api/repos/check`와 같다
- `404 COMMIT_NOT_FOUND`: 그 레포에 없는 commit. 이번에는 "검사한 commit과 입력의 commit이 다르다"는 오류가 따로 없다. 서버가 아직 검사한 commit(#45 보안 검사 결과)을 기억하지 않아서이고, 보안 검사가 들어오면 그 commit과 다를 때의 오류를 이 문서에 더한다. FE는 `COMMIT_NOT_FOUND`를 받으면 `repos/check`부터 다시 하게 하면 된다
- `409 SLUG_TAKEN`: 다른 사용자나 다른 레포가 쓰는 `slug`
- `503 AUTH_UNAVAILABLE` · `503 GITHUB_UNAVAILABLE`: `repos/check`와 같다
- `503 DATABASE_UNAVAILABLE`: 저장소(Supabase)에 닿지 못했거나 서버의 키가 거부당했다. 사용자 잘못이 아니므로 다시 시도하게 한다. 저장됐는지 알 수 없는 시간 초과면 같은 입력을 다시 보내도 된다(이미 저장됐다면 행이 하나 더 생길 뿐 같은 배포를 덮어쓰지 않는다)

### `GET /api/deploys/:id` — 저장한 배포 입력 읽기

응답 `200`: `POST /api/deploys`의 `201`과 같은 모양(`id` · `repo` · `commit` · `spec` · `createdAt`).

오류: `401`(위와 같다), `404 DEPLOY_NOT_FOUND`(없는 `id`이거나 내 것이 아니다. `id`가 UUID 모양이 아니어도 같다. 남의 배포가 있는지 알려 주지 않으려는 것이다), `503 DATABASE_UNAVAILABLE`.

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
