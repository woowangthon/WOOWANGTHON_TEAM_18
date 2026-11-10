# 배포 입력 (W3 → W4) — 설계

- **상태**: 초안
- **관련**: [배포 워크플로우](deploy-workflow.md) · [`POST /api/repos/deploy-spec`](api.md)

## 범위

- **한다**: W3이 끝난 뒤 W4에 넘기는 JSON(배포 입력)의 모양, 각 값을 채우는 단계, 검증 규칙.
- **하지 않는다**: 배포 위치(슬롯), 빌드 재사용 판단, 이미지 digest. 이 값들은 W4 이후가 정한다.

## 설계

### 구조

배포 입력은 세 부분이다.

| 부분 | 내용 | 채우는 단계 |
|---|---|---|
| `commitSha` | 빌드할 커밋 | W0 |
| `deploy_condition` | 이번 실행 조건 | `secretHash`: W3 · `services`: W4 |
| `spec` | 무엇을 어떻게 빌드하고 띄우나 | W1 · W2 |

- W0~W3은 `deploy_condition.services`를 항상 `null`로 보낸다. W4는 받은 값을 무시하고 새로 채운다.
- spec은 Dockerfile이 있든 없든 같은 스키마다. Dockerfile이 있으면 `build.dockerfile`에 경로만 넣는다. Dockerfile 내용은 spec에 넣지 않는다.
- Dockerfile이 없으면 `build`의 빌드 값(`framework` ~ `outputDir`)을 채운다. W4가 이 값과 플랫폼 기본 Dockerfile로 이미지를 만든다.
- 비밀값은 배포 입력에 없다. key 이름만 `runtime.secretKeys`에 넣고, 값은 W3이 Secret `<name>-secrets`에 넣는다.

### 예시

```json
{
  "commitSha": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  "deploy_condition": {
    "secretHash": "sha256:...",
    "services": null
  },
  "spec": {
    "project": {
      "slug": "my-app",
      "repo": "student/my-app"
    },
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
          "links": [{ "env": "AI_URL", "service": "ai" }],
          "ingressPath": "/api",
          "stripPrefix": false,
          "resources": null
        }
      },
      {
        "name": "ai",
        "role": "ai",
        "dir": "AI",
        "build": {
          "context": "AI",
          "dockerfile": "AI/Dockerfile",
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
          "port": 8000,
          "health": { "type": "http", "path": "/health", "startupTimeoutSeconds": 120 },
          "env": {},
          "secretKeys": ["OPENAI_API_KEY"],
          "links": [],
          "ingressPath": null,
          "stripPrefix": false,
          "resources": null
        }
      }
    ]
  }
}
```

### 필드

**최상위**

| 필드 | 타입 | 채우는 단계 | 뜻 |
|---|---|---|---|
| `commitSha` | 문자열 (40자 hex) | W0 | 빌드할 커밋. 브랜치 이름이나 `HEAD`를 쓰지 않는다 |
| `deploy_condition.secretHash` | 문자열 \| `null` | W3 | W3이 Secret에 넣은 값들의 sha256. 비밀 env가 없으면 `null`. 값이 바뀌면 W5가 Pod를 다시 띄운다 |
| `deploy_condition.services` | `null` \| 객체 | W4 | W3까지는 항상 `null`. W4가 아래 모양으로 채운다 |

**`deploy_condition.services`** (W4가 채운다)

키는 `spec.services[].name`이고, 값은 서비스마다 아래 객체다.

```json
"services": {
  "fe": { "buildInputHash": "sha256:...", "build": "reuse", "image": "ghcr.io/<봇 계정>/student-apps@sha256:..." },
  "be": { "buildInputHash": "sha256:...", "build": "run", "image": null }
}
```

| 필드 | 타입 | 뜻 |
|---|---|---|
| `buildInputHash` | 문자열 (`sha256:` + 64자 hex) | `commitSha` 시점의 `build.context` 폴더 git tree SHA + `build.dockerfile` 파일 blob SHA(있을 때) + 그 서비스의 `spec.build` + 플랫폼 기본 Dockerfile 버전의 해시. 커밋이 바뀌어도 그 서비스의 빌드 컨텍스트 · Dockerfile · 빌드 값이 그대로면 해시가 같다. `context`가 `"."`이면 레포 어디가 바뀌어도 해시가 바뀐다 |
| `build` | `run` \| `reuse` | `build_cache`에 같은 해시의 이미지가 있으면 `reuse`, 없으면 `run` |
| `image` | 문자열 \| `null` | 이미지 digest 주소. `reuse`면 W4 시작 때, `run`이면 빌드가 끝난 뒤 채운다 |

이미지는 모든 프로젝트 · 서비스가 공개 패키지 하나 `ghcr.io/<봇 계정>/student-apps`를 쓴다. 태그는 `<slug>-<name>-<buildInputHash 앞 12자>`이고, manifest에는 태그가 아니라 digest(`@sha256:...`)를 넣는다. GHCR은 새 패키지를 비공개로 만들므로([ADR-003](../adr/003-registry-ghcr.md)), 프로젝트 · 서비스마다 패키지를 만들면 노드가 토큰 없이 받을 수 없다.

**`spec.project`**

| 필드 | 타입 | 뜻 |
|---|---|---|
| `slug` | 문자열 | 프로젝트 이름. 네임스페이스 `proj-<slug>`, 공개 주소 `<slug>.<도메인>`에 쓴다 |
| `repo` | 문자열 | 학생 레포 `owner/name` |

**`spec.services[]`** (레포 안 서비스 폴더마다 하나, 1~3개)

| 필드 | 타입 | 뜻 |
|---|---|---|
| `name` | 문자열 | 서비스 이름. Deployment · Service · Secret 이름의 앞부분 |
| `role` | `fe` \| `be` \| `ai` | 서비스 역할. 적용 순서는 AI → BE → FE |
| `dir` | 문자열 | 레포 안 서비스 폴더. 루트는 `"."` |

**`build`** (W4에서만 쓴다)

| 필드 | 타입 | 뜻 |
|---|---|---|
| `context` | 문자열 | `docker build` 컨텍스트 폴더. 락 파일이 루트에 있으면 `"."` |
| `dockerfile` | 문자열 \| `null` | 학생 Dockerfile 경로. `null`이면 아래 빌드 값으로 빌드한다 |
| `framework` | `vite-react` \| `nextjs` \| `nest` \| `null` | 플랫폼 기본 Dockerfile 종류 |
| `nodeVersion` | 문자열 \| `null` | 베이스 이미지 `node:<버전>` |
| `install` | 문자열 \| `null` | 의존성 설치 명령 |
| `build` | 문자열 \| `null` | 빌드 명령 |
| `start` | 문자열 \| `null` | 서버 시작 명령 |
| `outputDir` | 문자열 \| `null` | 정적 빌드 결과 폴더 |
| `buildEnv` | 객체 (문자열 → 문자열) | 빌드할 때 번들에 들어가는 env (`VITE_*` 등) |

**`runtime`** (W5에서 manifest로 옮긴다)

| 필드 | 타입 | 뜻 |
|---|---|---|
| `kind` | `server` \| `static` | 서버 프로세스인지, 정적 파일인지 |
| `port` | 정수 | 컨테이너가 듣는 포트 |
| `health.type` | `http` \| `tcp` | 헬스체크 방식. W5가 manifest의 `startupProbe` · `readinessProbe`로 옮긴다 (`http` → `httpGet`, `tcp` → `tcpSocket`). Pod Ready는 이 헬스체크를 통과했다는 뜻이 된다 |
| `health.path` | 문자열 \| `null` | 헬스체크 경로. 컨테이너가 받는 경로 기준(`stripPrefix` 뒤). `tcp`면 `null` |
| `health.startupTimeoutSeconds` | 정수 (5~300) | 이 시간 안에 헬스체크를 처음 통과해야 한다. `startupProbe`의 `periodSeconds: 5`, `failureThreshold: ceil(값 / 5)`가 된다 |
| `env` | 객체 (문자열 → 문자열) | 비밀이 아닌 실행 시점 env |
| `secretKeys` | 문자열 배열 | 비밀 env의 key 이름 |
| `links` | `{ env, service }` 배열 | 다른 서비스 주소를 env `env`로 넣는다. 주소는 W5가 만든다 |
| `ingressPath` | 문자열 \| `null` | 공개 경로. `null`이면 내부 전용 |
| `stripPrefix` | 불리언 | `true`면 `ingressPath`를 떼고 컨테이너에 넘긴다 |
| `resources` | `{ cpu, memory }` \| `null` | 컨테이너 자원. 요청과 상한에 같은 값을 쓴다 (예: `{ "cpu": "500m", "memory": "512Mi" }`). `null`이면 요청 CPU 250m · 메모리 256Mi, 상한 CPU 1 · 메모리 2Gi |

### 검증 규칙

W4는 배포 입력을 받으면 아래 규칙으로 검사한다. 하나라도 어기면 배포하지 않는다.

| 대상 | 규칙 |
|---|---|
| `commitSha` | 40자 소문자 hex |
| `slug` | 소문자 영숫자 · 하이픈, 1~40자, 하이픈으로 시작 · 끝나지 않음, 예약 이름(`www` · `api` · `admin` · `mail` 등) 아님 |
| `services` | 1~3개. `name`은 소문자 영숫자 · 하이픈, 1~30자, 프로젝트 안에서 유일. `role`은 역할마다 최대 하나 |
| `build.dockerfile` 있음 | `framework` · `nodeVersion` · `install` · `build` · `start` · `outputDir`은 모두 `null` |
| `build.dockerfile` 없음 | `framework` · `nodeVersion` · `install` · `build` 필수. `kind: server`면 `start` 필수, `kind: static`이면 `outputDir` 필수 |
| `kind: static` | `start`는 `null`, `port`는 `8080`, `env` · `secretKeys` · `links`는 비어 있음 |
| `kind: server` | `outputDir`는 `null` |
| `buildEnv` | key가 `secretKeys`와 겹치지 않음 |
| `links[].service` | `spec.services`에 있는 `name` |
| `ingressPath` | 서비스끼리 겹치지 않음 |
| `health.type: http` | `health.path` 필수 |
| `health.startupTimeoutSeconds` | 5 이상 300 이하 |
| `resources` 합계 | 모든 서비스의 요청 합 × 2 ≤ 프로젝트 요청 상한(CPU 4 · 메모리 16Gi), 상한 합 × 2 ≤ 프로젝트 상한(CPU 8 · 메모리 32Gi). × 2는 확인 중 두 슬롯이 같이 뜨기 때문이다. 숫자는 [클러스터 설계](cluster.md) §6의 ResourceQuota 값을 따른다 |
| `deploy_condition.services` (W3에서 받을 때) | 검사하지 않음 (W4가 덮어쓴다) |
| `deploy_condition.services` (W4가 채운 뒤) | 키 집합이 `spec.services[].name`과 같음. `build: reuse`면 `image` 필수, `build: run`이면 빌드 전 `image`는 `null` |

## 알려진 한계

- `framework`는 `vite-react` · `nextjs` · `nest`만 지원한다. 그 밖의 레포는 학생 Dockerfile이 있어야 한다.
- [`POST /api/repos/deploy-spec`](api.md) 응답(`{ value, source }` 모양)과 이 spec은 모양이 다르다. W2가 응답을 이 spec으로 옮긴다.
