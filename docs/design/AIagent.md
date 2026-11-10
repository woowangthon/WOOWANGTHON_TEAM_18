# AI 에이전트 — 설계

- **상태**: 초안
- **관련**: [배포 워크플로우](deploy-workflow.md) §6 · [배포 입력](deploy-handoff.md) · [ADR-009](../adr/009-deploy-runs-on-leader-gocd-agent.md) · [ADR-011](../adr/011-deploy-slots-a-b.md) · [ADR-012](../adr/012-agent-acts-through-platform-gateway.md) · [ADR-002](../adr/002-bot-account-for-fix-prs.md) (봇 계정 수정 PR)

![AI 에이전트 흐름](../architecture/agent-flow.drawio.svg)

## 범위

- **한다**: 문제 티켓을 받아 원인을 분류하고, MCP 게이트웨이의 도구로 대상 슬롯에서 Build · Render · Deploy · Verify를 실행 · 관찰하며 고친 뒤, 해결 결과를 플랫폼 서버에 돌려준다.
- **하지 않는다**: live 전환, live 슬롯 변경, Secret 읽기 · 쓰기, ResourceQuota · LimitRange · NetworkPolicy 변경, manifest(YAML) 작성. 에이전트는 spec 수정안(`specPatch`)만 내고 YAML은 플랫폼 코드(Render)가 만든다.

## 설계

### 1. 흐름

```
플랫폼 서버                                AI 서버 (PydanticAI 에이전트)
문제 티켓 발행 ─────────────────────────▶ ① 분류: 코드 대조 (장기 메모리 case의 match)
                                          ② 못 맞추면 LLM 분류 (로컬 모델)
                                          ├─ 알려진 case → ③ playbook (정해진 툴 순서)
                                          │     실패 → ④ 실패 기반 planning (추론 모델 API)
                                          └─ unknown → ⑤ planning (추론 모델 API)
                                          도구 실행 → 결과(원본) 관찰 → 다시 계획 … (횟수 제한 안에서)
해결 결과 수신 ◀──────────────────────── submit_result
  verified → 대상 슬롯 재확인(run_verify) → Switch → W7
  pr_opened · needs_user → 대기
  gave_up → 보고
종료 알림 (success · superseded · stopped) ─▶ case 통계 갱신, 실행 종료
```

- 워크플로우는 티켓 하나(`ticketId`)를 보관한다. 새 티켓이 나오면 이전 티켓을 덮어쓰고, 새 티켓의 `previous`에 직전 티켓 id · 상태 · 요약 한 줄을 넣는다.
- 에이전트는 해결됐다고 판정하지 않는다. 판정은 플랫폼이 대상 슬롯 재확인과 W7 결과로 한다.
- 플랫폼 문제(CodeBuild API 오류, GHCR 받기 실패, live 슬롯 보호 중단 등)는 플랫폼 서버가 코드로 걸러 에이전트를 부르지 않는다.

### 2. 도구가 닿는 길

```
AI 서버 (에이전트) → 플랫폼 서버 MCP 게이트웨이 → GoCD 서버 → AWS 실행기(Build) · 리더 실행기(Prepare ~ Switch)
                                              → k3s API 읽기 (Pod · 이벤트 · 로그)
                                              → 봇 계정 GitHub (fork 커밋, PR)
```

- 에이전트(AI 서버)에는 클러스터 · GoCD · 봇 계정 자격 증명이 없다. 도구는 모두 게이트웨이가 실행한다([ADR-012](../adr/012-agent-acts-through-platform-gateway.md)).
- 게이트웨이는 GoCD 파이프라인을 환경 변수 옵션으로 실행한다: 대상 슬롯, 시작 스테이지, `DRY_RUN_ONLY`, `SKIP_SWITCH=true`, 소스 커밋(봇 fork). 환경 변수에 비밀값은 넣지 않는다.
- 게이트웨이는 모든 실행 도구에서 `specPatch` 경로 검사와 live 슬롯 보호 검사를 한다.

### 3. 도구

**실행 (대상 슬롯만)**

| 도구 | 하는 일 | 입력 | 출력 | 티켓당 횟수 |
|---|---|---|---|---|
| `run_build` | Build (CodeBuild). 해시가 같으면 재사용 | `service`, `specPatch?`, `source?` | `BatchGetBuilds`의 `builds[0]` 원본, 실패 phase, 로그 마지막 200줄, 성공 시 이미지 digest | 2 |
| `run_render` | Render + `kubectl apply --dry-run=server`. 클러스터에 적용하지 않는다 | `specPatch?` | 통과 여부, 실패 시 k3s Status 원본 | 5 |
| `run_deploy` | Prepare(live 슬롯 보호 검사, 대상 슬롯 비우기) → Render → Apply → Ready 대기 | `specPatch?`, `source?` | Pod · 이벤트 원본, rollout 결과 | 2 |
| `run_verify` | Verify (test Ingress, Traefik 요청) | 없음 | 요청별 경로 · 상태 코드 · 응답 시간 | 3 |

- `specPatch`는 시험용 수정안이다. 그 실행에만 적용하고 DB의 spec은 바꾸지 않는다. DB 저장은 플랫폼이 `verified`를 받은 뒤 한다.
- `source`는 수정 PR 확인용 봇 fork 커밋이다.
- `specPatch` 없이 다시 부르면 그대로 재실행이다 (일시적 실패용).

**관찰 (읽기만)**

| 도구 | 하는 일 | 출력 |
|---|---|---|
| `get_target_status` | 대상 슬롯의 Pod · 이벤트 · rollout 상태를 지금 시점으로 읽음 | k3s 원본 (`managedFields` 제외) |
| `read_pod_logs` | 대상 슬롯 Pod 로그 | 로그 줄. `previous: true`면 직전 컨테이너 |
| `read_build_logs` | CodeBuild 로그의 지정 구간 | 로그 줄 |
| `read_repo` | 티켓의 `commitSha` 시점 파일 · 폴더 목록 | 파일 내용 |
| `read_memory` | 장기 메모리 case 검색 | case · playbook |

**레포 수정**

| 도구 | 하는 일 | 제한 |
|---|---|---|
| `edit_repo_file` | 봇 fork 작업 브랜치에 파일 수정 commit. 그 커밋을 `source`로 실행 도구에 넘긴다 | 파일 5개 · 50줄, `.env` · `.github/` 금지 |
| `open_pr` | 학생 레포에 수정 PR | 티켓당 1개. 게이트웨이가 같은 `source`로 `run_verify` 통과를 확인한 뒤에만 연다 |

**끝내기**

| 도구 | 하는 일 |
|---|---|
| `submit_result` | 해결 결과 제출. 호출하면 에이전트 실행이 끝난다 |

전체 제한: 도구 20회, 에이전트 작업 15분(파이프라인 대기 제외), 같은 도구 · 같은 인자 연속 2회 차단. 게이트웨이가 센다. 숫자는 초기값이다.

### 4. 행위 범위

| 행위 | 범위 |
|---|---|
| 진단 | 관찰 도구로 로그 · 이벤트 · 레포를 읽는다 |
| spec 수정 + 시험 | `build` · `runtime` 아래만: 포트, 헬스체크, Node 버전, 빌드 명령, `context` · `outputDir` · `dockerfile`, `buildEnv` key, `env`, `resources`(쿼터 안), `startupTimeoutSeconds` |
| 그대로 재실행 | 고칠 것이 없는 일시적 실패 (CodeBuild 준비 실패, 이미지 받기 시간 초과) |
| dry-run 먼저 | 이름 · 포트 · 쿼터 오류는 `run_render`로 먼저 확인한다 |
| 레포 수정 → PR | fork 커밋으로 `run_verify`까지 통과한 변경만 |
| 사용자 요청 | 비밀값이 틀림 · 빠짐, 학생 DB에 닿지 않음, 학생 DB 스키마 문제 |
| 플랫폼 문제 보고 | 이미지 공개 설정, 노드 자원 부족, 차트 · 기본 Dockerfile 문제 |

**주지 않는 행위**: live 전환(open Ingress), live 슬롯 변경 · 슬롯 직접 삭제, Secret 읽기 · 쓰기, ResourceQuota · LimitRange · NetworkPolicy 변경, `slug` · `name` 변경, Pod 안 명령 실행(`kubectl exec`), 기본 Dockerfile · 차트 수정.

### 5. 입력: 문제 티켓

정해진 칸은 봉투뿐이고, CodeBuild · k3s 출력은 원본 그대로 넣는다.

```json
{
  "ticketId": "t_0013",
  "commitSha": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  "stage": "apply",
  "service": "be",
  "targetSlot": "b",
  "deployInput": { "commitSha": "...", "deploy_condition": {}, "spec": {} },
  "errorMessage": "deployment \"be-b\" exceeded its progress deadline",
  "raw": {
    "codebuild": null,
    "k8s": { "pod": {}, "events": [] }
  },
  "logs": { "from": "2026-11-10T13:02:00Z", "to": "2026-11-10T13:12:00Z", "lines": [] },
  "previous": { "ticketId": "t_0012", "status": "needs_user", "summary": "DATABASE_URL 재입력 요청" }
}
```

| 칸 | 내용 |
|---|---|
| `stage` | `build` · `prepare` · `render` · `apply` |
| `service` | `spec.services[].name`. 서비스와 무관하면 `null` |
| `targetSlot` | `a` · `b` |
| `raw.codebuild` | `BatchGetBuilds`의 `builds[0]` 원본. Build가 아니면 `null` |
| `raw.k8s.pod` | 실패한 Pod 하나의 원본. `metadata.managedFields`와 적용 기록 annotation은 뺀다 |
| `raw.k8s.events` | `involvedObject`가 대상 슬롯 리소스인 이벤트 원본 |
| `logs` | 오류 시각 10분 전부터, 최대 200줄. 재시작한 Pod는 직전 컨테이너 로그 |
| `previous` | 직전 티켓. 없으면 `null` |

모든 칸은 보내기 전에 외부 전송 필터로 비밀값처럼 보이는 문자열을 가린다.

### 6. 출력: 해결 결과

```json
{
  "type": "object",
  "required": ["ticketId", "commitSha", "status", "classification", "actions", "summary"],
  "additionalProperties": false,
  "properties": {
    "ticketId":  { "type": "string" },
    "commitSha": { "type": "string", "pattern": "^[0-9a-f]{40}$" },
    "status":    { "enum": ["verified", "pr_opened", "needs_user", "gave_up"] },
    "classification": {
      "type": "object",
      "required": ["method", "caseId", "path"],
      "properties": {
        "method": { "enum": ["code", "llm"] },
        "caseId": { "type": ["string", "null"] },
        "path":   { "enum": ["playbook", "replan_after_playbook", "plan"] }
      }
    },
    "actions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["tool", "ok"],
        "properties": {
          "tool":   { "type": "string" },
          "args":   { "type": "object" },
          "ok":     { "type": "boolean" },
          "result": { "type": "string" }
        }
      }
    },
    "specPatch": {
      "type": ["array", "null"],
      "items": {
        "type": "object",
        "required": ["op", "path"],
        "properties": {
          "op":    { "enum": ["replace", "add", "remove"] },
          "path":  { "type": "string", "pattern": "^/spec/services/[0-9]+/(build|runtime)/" },
          "value": {}
        }
      }
    },
    "pr": {
      "type": ["object", "null"],
      "properties": {
        "url":          { "type": "string" },
        "files":        { "type": "array", "items": { "type": "string" }, "maxItems": 5 },
        "changedLines": { "type": "integer", "maximum": 50 }
      }
    },
    "userRequest": {
      "type": ["object", "null"],
      "properties": {
        "message":    { "type": "string" },
        "secretKeys": { "type": "array", "items": { "type": "string" } }
      }
    },
    "evidence": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "ref":  { "type": "string" },
          "text": { "type": "string" }
        }
      }
    },
    "summary": { "type": "string" }
  }
}
```

| `status` | 필수 칸 | 플랫폼 서버가 하는 일 |
|---|---|---|
| `verified` | `specPatch` (재실행만 했으면 빈 배열) | `specPatch` 검증 → DB 저장 → 대상 슬롯 `run_verify` 재확인 → Switch → W7 |
| `pr_opened` | `pr` | 사용자 머지 대기. 머지되면 새 커밋으로 W0부터 |
| `needs_user` | `userRequest` | 사용자에게 요청 |
| `gave_up` | `summary` | 보고 |

- `JSON Patch`(RFC 6902) 경로는 `build` · `runtime` 아래만 허용한다. `slug` · `name`을 바꾸면 네임스페이스와 Secret을 잃는다.
- `summary`는 다음 티켓의 `previous.summary`로 쓴다.
- PydanticAI 에이전트의 출력 타입을 이 스키마의 Pydantic 모델로 두어, 모양이 틀린 결과는 에이전트 안에서 다시 만들게 한다.

### 7. 종료 알림

```json
{ "ticketId": "t_0013", "commitSha": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", "reason": "success" }
```

| `reason` | 언제 |
|---|---|
| `success` | 대상 슬롯 재확인 · Switch · W7까지 성공 |
| `superseded` | 처리 중에 사용자가 새 커밋을 push함 |
| `stopped` | 플랫폼이 중단함 (제한 시간 초과, 플랫폼 문제) |

에이전트는 `success`일 때 사용한 case의 `stats.solved`를 올린다.

### 8. 장기 메모리

**case 구조**

```json
{
  "caseId": "A1",
  "stage": "apply",
  "category": "spec",
  "title": "헬스체크 실패 (포트 · 경로 · 시작 시간)",
  "match": {
    "path": "raw.k8s.events[*].reason",
    "equals": "Unhealthy",
    "messageRegex": "(Readiness|Startup) probe failed"
  },
  "playbook": [
    { "tool": "read_pod_logs", "args": { "lines": 100 } },
    { "tool": "run_render", "when": "로그의 listen 포트가 runtime.port와 다름", "args": { "specPatch": [{ "op": "replace", "path": "/spec/services/{i}/runtime/port", "value": "{listenPort}" }] } },
    { "tool": "run_deploy", "args": { "specPatch": "앞 단계와 같음" } },
    { "tool": "run_verify" }
  ],
  "stats": { "hits": 0, "solved": 0 }
}
```

- `match`는 티켓 원본의 JSON 경로로 쓴다. 중간 스키마가 없어서 원본 필드 이름만 따라가면 된다.
- planning으로 해결한 새 case는 바로 넣지 않는다. 사람이 확인한 뒤 넣는다.

**초기 case** (개인 · 소규모 팀의 Node 웹 프로젝트 기준 추정. 실패 주입 시험으로 고친다)

| case | 단계 | 오류 | 신호 | 처리 |
|---|---|---|---|---|
| `B1` | build | 락 파일 불일치 | `INSTALL` 실패, `ERR_PNPM_OUTDATED_LOCKFILE`, `npm ci` sync 오류 | 수정 PR (락 파일 갱신) |
| `B2` | build | Node 버전 불일치 | `engine "node" is incompatible`, `SyntaxError: Unexpected token` | `build.nodeVersion` |
| `B3` | build | 빌드 시점 env 누락 | `BUILD` 실패, `import.meta.env.VITE_*` undefined | `build.buildEnv` 또는 사용자 요청 |
| `B4` | build | 대소문자 · import 경로 | `Module not found`, `Cannot find module` | 수정 PR |
| `B5` | build | `COPY` 대상 없음 | `COPY failed`, `"/dist": not found` | `build.context` · `outputDir` · `dockerfile` |
| `P1` | prepare | 필수 Secret key 없음 | W3 상태 "빠짐" | 사용자 요청 |
| `P2` | prepare | 자원 합계 초과 | 검증 규칙 `resources` 합계 | `runtime.resources` |
| `P3` | prepare | `ingressPath` 충돌 | 검증 규칙 `ingressPath` | `runtime.ingressPath` |
| `R1` | render | 이름 규칙 위반 | `422 Invalid`, `FieldValueInvalid`, `DNS-1035` | 사용자 요청 (`name`은 바꾸지 않음) |
| `R2` | render | 포트 · probe 값 오류 | `422 Invalid`, field `...containerPort` | `runtime.port` · `health` |
| `R3` | render | 쿼터 초과 | `403 Forbidden`, `exceeded quota` | `runtime.resources` |
| `A1` | apply | 헬스체크 실패 | 이벤트 `Unhealthy` | `runtime.port` · `health.path` · `startupTimeoutSeconds` |
| `A2` | apply | 시작 직후 종료 | `CrashLoopBackOff`, `exitCode` ≠ 0 | 로그 패턴: env 누락 → `runtime.env`, DB 연결 실패 → 사용자 요청 |
| `A3` | apply | 메모리 초과 | `OOMKilled` (137) | `runtime.resources.memory` |
| `A4` | apply | Pod 생성 실패 (쿼터) | ReplicaSet 이벤트 `FailedCreate` + `exceeded quota` | `runtime.resources` |

에이전트를 부르지 않는 플랫폼 문제: CodeBuild API 오류(`AccountLimitExceededException` · `InvalidInputException` · `ResourceNotFoundException`), GHCR push 거부, `ImagePullBackOff` · `ErrImagePull`, `FailedScheduling`(노드 자원 부족), 차트 렌더 실패, 검사 규칙 거부, live 슬롯 보호 중단, 네임스페이스 · Secret 없음.

### 9. 모델

| 쓰는 곳 | 모델 |
|---|---|
| ② LLM 분류, 도구 고르기 | 로컬 Qwen3-8B (리더 vLLM, OpenAI 호환 API) |
| ④ · ⑤ planning | 추론 모델 API (모델 이름 미정, [배포 워크플로우](deploy-workflow.md) §7) |

PydanticAI에서 두 모델을 OpenAI 호환 provider로 붙이고, 추론 모델 API를 못 쓰면 로컬 모델로 넘긴다.

## 알려진 한계

- 학생 DB 자체의 문제(테이블 없음, migration 안 함)는 에이전트가 학생 DB에 닿지 못해 고칠 수 없다. `needs_user`로 넘긴다.
- 초기 case 목록과 신호는 추정이다. 실패 주입 시험 전이다.
- CodeBuild API의 오류 이름 · phase 값은 AWS 문서와 대조하지 않았다.
- 로컬 8B 모델의 분류 · 도구 호출 품질은 검증하지 않았다.
