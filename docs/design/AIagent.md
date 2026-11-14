# AI 에이전트 — 설계

- **상태**: 초안
- **관련**: [배포 워크플로우](deploy-workflow.md) §6 · [배포 입력](deploy-handoff.md) · [ADR-009](../adr/009-deploy-runs-on-leader-gocd-agent.md) · [ADR-011](../adr/011-deploy-slots-a-b.md) · [ADR-012](../adr/012-agent-acts-through-platform-gateway.md) · [ADR-014](../adr/014-agent-trial-pipeline-and-rerun.md) (시험 전용 파이프라인 · verified 뒤 다시 실행) · [ADR-016](../adr/016-planner-model-nova-gateway.md) · [ADR-017](../adr/017-planner-plans-local-executes.md) (모델 · 계획과 실행 분리) · [ADR-002](../adr/002-bot-account-for-fix-prs.md) (봇 계정 수정 PR)

![AI 에이전트 흐름](../architecture/agent-flow.drawio.svg)

> **주의**: 이 그림은 ADR-014 · ADR-017 이전 내용(시험 파이프라인의 "옵션: Switch 건너뜀", "② 못 맞추면 LLM", "verified → 재확인 → Switch · W7")이 남아 있다. 다시 그리는 중이다([#230](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/230)). 아래 본문과 ADR이 현재 기준이다.

## 범위

- **한다**: 문제 티켓을 받아 원인을 분류하고, MCP 게이트웨이의 도구로 대상 슬롯에서 Build · Render · Deploy · Verify를 실행 · 관찰하며 고친 뒤, 해결 결과를 플랫폼 서버에 돌려준다.
- **범위**: 사용자 코드를 직접 바꾸는 것을 빼고 배포 설정 전부다. spec과 CodeBuild 빌드 설정(그 빌드에만)을 에이전트가 조정한다. 코드 수정은 수정 PR로 제안하고 머지는 사용자가 한다.
- **하지 않는다**: live 전환(플랫폼이 한다), live 슬롯 · 다른 프로젝트 변경, Secret 값 읽기 · 쓰기, 플랫폼이 같이 쓰는 설정(CodeBuild 프로젝트 · buildspec · IAM, ResourceQuota · LimitRange · NetworkPolicy, 차트, 기본 Dockerfile) 변경, manifest(YAML) 작성. YAML은 플랫폼 코드(Render)가 spec으로 만든다.

## 설계

### 1. 흐름

```
플랫폼 서버                                AI 서버 (PydanticAI 에이전트)
문제 티켓 발행 ─────────────────────────▶ ① 정규식 대조 (장기 메모리 case의 match): 힌트로만 쓴다
                                          ② 분류 (추론 모델 API): ①의 힌트를 참고해 case를 고르거나 null
                                          ├─ 알려진 case → ③ 추론 모델이 playbook을 참고하고 읽기 도구로 증거를 읽어 계획(바꾸는 도구는 부르지 않음)
                                          │     → 로컬 모델이 계획에 있는 도구만으로 실행
                                          │     실패 · 거절 → ④ 재계획 (추론 모델 API가 직접 도구를 부름)
                                          └─ unknown → ⑤ planning (추론 모델 API가 직접 도구를 부름)
                                          도구 실행 → 결과(원본) 관찰 → 다시 계획 … (횟수 제한 안에서)
해결 결과 수신 ◀──────────────────────── submit_result
  verified → 고친 입력으로 배포 파이프라인을 처음부터 다시 실행(Verify가 재확인) → Switch → W7
  pr_opened · needs_user → 대기
  gave_up → 보고
종료 알림 (success · superseded · stopped) ─▶ case 통계 갱신, 실행 종료
```

- 워크플로우는 티켓 하나(`ticketId`)를 보관한다. 새 티켓이 나오면 이전 티켓을 덮어쓰고, 새 티켓의 `previous`에 직전 티켓 id · 상태 · 요약 한 줄을 넣는다.
- 에이전트는 해결됐다고 판정하지 않는다. 판정은 플랫폼이 대상 슬롯 재확인과 W7 결과로 한다.
- 플랫폼 문제(CodeBuild API 오류, GHCR 받기 실패, live 슬롯 보호 중단 등)는 플랫폼 서버가 코드로 걸러 에이전트를 부르지 않는다.

**오류를 아는 방법.** 에이전트는 오류를 직접 감지하지 않고, k3s를 계속 조회하지도 않는다. 감지는 플랫폼이 하고, 에이전트는 티켓으로 시작한 뒤 필요한 정보를 도구로 읽는다.

| 단계 | 누가 · 어떻게 |
|---|---|
| 감지 (배포 중) | GoCD 스테이지가 한다. Build는 CodeBuild 결과, Apply는 대상 슬롯 Pod · 이벤트 watch(`CrashLoopBackOff` · `OOMKilled` · 쿼터 초과 `FailedCreate`는 제한 시간을 기다리지 않고 바로 실패), Verify는 Traefik 요청 결과 ([배포 워크플로우](deploy-workflow.md) §4 제한 시간) |
| 감지 (운영 중) | 플랫폼 서버가 리더 k3s API에 Pod · 이벤트 watch 연결을 유지한다. 로그는 계속 받지 않는다 |
| 알림 | 각 GoCD job의 마지막 task(`run_if: any`)가 통과 · 실패를 그 즉시 플랫폼 서버에 알린다 |
| 전달 | 플랫폼 서버가 그 순간의 원본 · 최근 10분 로그를 잡아 비밀값을 가리고 문제 티켓으로 보낸다 |
| 수집 | 에이전트가 티켓의 `stage` · `service`로 실패한 단계에서 바로 고치기 시작하고, 지금 상태는 관찰 도구(§3)로 그때그때 읽는다 |

티켓의 역할은 넷이다: 에이전트 실행을 여는 시작 신호, 재시작하면 사라지는 실패 순간의 증거 보관, 횟수 제한 · 해결 결과 · 종료 알림 · `previous`를 묶는 일의 단위(`ticketId`), 코드 분류(§8 `match`)의 입력. 에이전트가 아는 정보가 티켓이 전부라는 뜻은 아니다.

### 2. 도구가 닿는 길

```
AI 서버 (에이전트) → 플랫폼 서버 MCP 게이트웨이 → GoCD 서버 → AWS 실행기(Build) · 리더 실행기(Prepare ~ Switch)
                                              → k3s API 읽기 (Pod · 이벤트 · 로그)
                                              → 봇 계정 GitHub (fork 커밋, PR)
```

- 에이전트(AI 서버)에는 클러스터 · GoCD · 봇 계정 자격 증명이 없다. 도구는 모두 게이트웨이가 실행한다([ADR-012](../adr/012-agent-acts-through-platform-gateway.md)). 예외는 AI 서버 자신의 장기 메모리를 읽는 `read_memory` 하나다(클러스터 · GitHub에 닿지 않는다).
- 게이트웨이는 시험 전용 GoCD 파이프라인 `student-trial`(Build → Prepare → Render → Apply → Verify, Switch 없음. Build는 AWS 실행기)을 환경 변수 옵션으로 실행한다: 시험 id `TRIAL_ID`, 돌릴 스테이지 `TRIAL_STAGES`(`run_build` = `build`, `run_render` = `render`, `run_deploy` = `prepare,render,apply`, `run_verify` = `verify`). 공개 주소는 `verified` 뒤 다시 실행하는 `student-deploy`의 Switch로만 바뀐다. 대상 슬롯 · `specPatch`를 적용한 입력은 파이프라인이 시험 id로 읽어 간다. 환경 변수에 비밀값은 넣지 않는다. 모양은 [API 계약](api.md) "파이프라인 ↔ 플랫폼 서버" 4번, 결정은 [ADR-014](../adr/014-agent-trial-pipeline-and-rerun.md)(ADR-012 일부 대체)다. 소스 커밋(봇 fork)은 `source`로 넘긴다: 시험 입력의 `commitSha` · `spec.project.repo`를 봇 fork의 commit으로 바꿔 Build가 그 commit을 받는다([API 계약](api.md) "레포 수정(F13)").
- 게이트웨이는 모든 실행 도구에서 `specPatch` 경로 검사와 live 슬롯 보호 검사를 한다.
- 티켓 접수 · 종료 알림 API, 게이트웨이 접속 · 토큰(티켓마다 하나), 도구마다의 인자 · 결과 모양과 거절 코드는 [API 계약](api.md) "AI 에이전트"에 있다.

### 3. 도구

**실행 (대상 슬롯만)**

| 도구 | 하는 일 | 입력 | 출력 | 티켓당 횟수 |
|---|---|---|---|---|
| `run_build` | Build (CodeBuild). 해시가 같은 이미지가 이미 있으면 빌드하지 않고 바로 `reused: true`와 그 이미지로 답한다(#149) | `service`, `specPatch?`, `source?`, `buildOverrides?` | `BatchGetBuilds`의 `builds[0]` 원본, 실패 phase, 로그 마지막 200줄, 성공 시 이미지 digest | 2 |
| `run_render` | Render + k3s API server-side apply dry-run. 클러스터에 적용하지 않는다 | `specPatch?` | 통과 여부, 실패 시 k3s Status 원본 | 5 |
| `run_deploy` | Prepare(live 슬롯 보호 검사, 대상 슬롯 비우기) → Render → Apply → Ready 대기 | `specPatch?`, `source?` | Pod · 이벤트 원본, rollout 결과 | 2 |
| `run_verify` | Verify. 배포 입력에 있는 공개 서비스와 설정된 경로만 test Ingress로 Traefik에 요청하고, 내부 전용 서비스는 Pod Ready만 본다([배포 워크플로우](deploy-workflow.md) §4) | 없음 | 요청별 경로 · 상태 코드 · 응답 시간, 서비스별 Ready | 3 |

- `specPatch`는 시험용 수정안이다. 그 실행에만 적용하고 DB의 spec은 바꾸지 않는다. DB 저장은 플랫폼이 `verified`를 받은 뒤 한다.
- `source`는 수정 PR 확인용 봇 fork 커밋이다.
- `specPatch` 없이 다시 부르면 그대로 재실행이다 (일시적 실패용).
- `buildOverrides`는 그 빌드에만 쓰는 CodeBuild 설정이다. 게이트웨이가 `StartBuild`의 override로 넘기고, CodeBuild 프로젝트 설정(`UpdateProject`)은 바꾸지 않는다. 모든 학생 프로젝트가 프로젝트 하나를 같이 쓰기 때문이다.

| `buildOverrides` 칸 | CodeBuild 값 | 상한 (초기값) |
|---|---|---|
| `computeType` | `computeTypeOverride` | 프로젝트 기본(SMALL)만. 무료 티어 밖 크기는 받지 않는다(2026-11-14) |
| `timeoutMinutes` | `timeoutInMinutesOverride` | 20분(시험 빌드의 대기 = `timeoutMinutes` + 5분이 시험 대기 30분 안에 들게) |
| `image` | `imageOverride` | 플랫폼이 정한 빌드 이미지 허용 목록(빌드가 docker로 돌므로 privileged 모드에서 docker가 도는 CodeBuild 표준 이미지만) |
| `cache` | `cacheOverride`: `false`면 `{ type: NO_CACHE }`, `true`거나 없으면 override 안 함(프로젝트 설정 그대로) | - |

`computeType` · `image`는 값 그대로 넘기고, 상한 · 허용 목록 검사는 게이트웨이가 한다(밖이면 `OVERRIDE_LIMIT`). buildspec · 서비스 역할(IAM) · 환경 변수 override는 받지 않는다. 빌드 명령을 바꿀 수 있으면 push 단계의 GHCR 토큰을 빼 갈 수 있다([배포 워크플로우](deploy-workflow.md) §8).

**관찰 (읽기만)**

| 도구 | 하는 일 | 출력 |
|---|---|---|
| `get_target_status` | 대상 슬롯의 Pod · 이벤트 · rollout 상태를 지금 시점으로 읽음 | k3s 원본 (`managedFields` 제외) |
| `read_pod_logs` | 대상 슬롯 Pod 로그 | 로그 줄. `previous: true`면 직전 컨테이너 |
| `read_repo` | 티켓의 `commitSha` 시점 파일 · 폴더 목록 | 파일 내용 |
| `read_memory` | 장기 메모리 case 검색. **AI 서버 안의 도구다(게이트웨이를 거치지 않음)**. case와 통계를 AI 서버가 갖기 때문이다(§8) | case · playbook |

**레포 수정**

| 도구 | 하는 일 | 제한 |
|---|---|---|
| `edit_repo_file` | 봇 fork 작업 브랜치에 파일 수정 commit(파일 전체 내용 `content`, 또는 한 번만 있는 글을 바꾸는 `find` · `replace`). 그 커밋을 `source`로 실행 도구에 넘긴다. 학생 레포에는 쓰지 않는다 | 티켓 전체에서 파일 5개 · 바뀐 줄 50줄(지운 줄 + 넣은 줄), `.env` · `.github/` 금지, 비밀값 모양의 줄 금지. 티켓당 5회 |
| `open_pr` | 학생 레포에 수정 PR. PR을 열 수 없으면 `{ url: null, patchAttached: true }`(patch는 플랫폼이 `needs_user` 안내에 붙인다) | 티켓당 1개(2회). 게이트웨이가 같은 `source`로 `run_deploy` → `run_verify` 통과를 확인한 뒤에만 연다(`NOT_VERIFIED`) |

**끝내기**

| 도구 | 하는 일 |
|---|---|
| `submit_result` | 해결 결과 제출. 호출하면 에이전트 실행이 끝난다 |

전체 제한: 도구 20회, 에이전트 작업 15분(파이프라인 대기 제외)과 티켓 전체 60분(대기 포함), 같은 도구 · 같은 인자는 연속 2회까지(세 번째 호출 차단). 게이트웨이가 센다. 숫자는 초기값이다.

### 4. 행위 범위

| 행위 | 범위 |
|---|---|
| 진단 | 관찰 도구로 로그 · 이벤트 · 레포를 읽는다 |
| spec 수정 + 시험 | `build` · `runtime` 전체: 포트, 헬스체크, 빌드 · 설치 · 시작 명령, Node 버전, `context` · `dockerfile` · `outputDir`, `buildEnv`, `env`, `secretKeys` 목록, `links`, `ingressPath`, `stripPrefix`, `resources`(프로젝트 쿼터 안), `startupTimeoutSeconds` |
| `slug` · `name` 수정 | 하지 않는다. 슬롯과 Secret 이름이 따라가므로 대상 슬롯에서 시험할 수 없어 게이트웨이가 `PATCH_FORBIDDEN`으로 막는다 |
| CodeBuild 빌드 설정 | 그 빌드에만, `buildOverrides` 상한 안 (§3) |
| 그대로 재실행 | 고칠 것이 없는 일시적 실패 (CodeBuild 준비 실패, 이미지 받기 시간 초과) |
| dry-run 먼저 | 이름 · 포트 오류는 `run_render`로 먼저 확인한다. 자원 합계(쿼터)는 `run_render`에서 걸리지 않고 `run_deploy`의 Prepare에서 걸린다(case `P2`). `run_render`는 `source`를 받지 않아 원래 commit만 시험하므로, 레포 수정 → PR 경로는 `run_build` → `run_deploy`로 바로 간다 |
| 레포 수정 → PR | fork 커밋으로 `run_verify`까지 통과한 변경만 |
| 사용자 요청 | 비밀값이 틀림 · 빠짐, 학생 DB에 닿지 않음, 학생 DB 스키마 문제 |
| 플랫폼 문제 보고 | 이미지 공개 설정, 노드 자원 부족, 차트 · 기본 Dockerfile 문제 |

**주지 않는 행위**

| 대상 | 이유 |
|---|---|
| 사용자 코드 직접 수정 | 수정 PR로 제안하고 머지는 사용자가 한다 |
| live 전환(open Ingress) | 사용자 요청이 바뀌는 단계라 플랫폼이 대상 슬롯을 다시 확인한 뒤 한다 |
| live 슬롯 · 다른 프로젝트 | 사용자 서비스가 멈추거나 다른 학생에게 영향이 간다 |
| Secret 값 | 사용자 데이터다. 값이 틀리면 사용자에게 요청한다 |
| CodeBuild 프로젝트 설정 · buildspec · IAM · 환경 변수 override | 모든 프로젝트가 같이 쓰고, GHCR 토큰이 새어 나갈 수 있다 |
| ResourceQuota · LimitRange · NetworkPolicy · 차트 · 기본 Dockerfile | 모든 프로젝트가 같이 쓰는 플랫폼 설정이다 |
| Pod 안 명령 실행(`kubectl exec`) | 학생 컨테이너 안에서 임의 명령을 실행하는 권한이다 |

### 5. 입력: 문제 티켓

정해진 칸은 봉투뿐이고, CodeBuild · k3s 출력은 원본 그대로 넣는다. 원본은 플랫폼 서버가 실패 알림을 받은 순간에 읽은 스냅샷이다. 이후 상태는 에이전트가 관찰 도구로 다시 읽는다.

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
    "k8s": { "pod": {}, "events": [], "status": null }
  },
  "logs": { "from": "2026-11-10T13:02:00Z", "to": "2026-11-10T13:12:00Z", "lines": [] },
  "previous": { "ticketId": "t_0012", "status": "needs_user", "summary": "DATABASE_URL 재입력 요청" }
}
```

| 칸 | 내용 |
|---|---|
| `stage` | `build` · `prepare` · `render` · `apply` · `verify`. `switch`는 없다(전환 실패는 학생 쪽에서 고칠 것이 없어 플랫폼이 `failed`로 마감한다) |
| `service` | `spec.services[].name`. 서비스와 무관하면 `null` |
| `targetSlot` | `a` · `b` |
| `raw` | stage에 따라 두 모양만 받는다. `build`: `{ "codebuild": <원본>, "k8s": null }`. 그 밖: `{ "codebuild": null, "k8s": { "pod", "events", "status" } }` |
| `raw.codebuild` | `BatchGetBuilds`의 `builds[0]` 원본. `build`가 아니면 `null` |
| `raw.k8s.pod` | 실패한 Pod 하나의 원본. 없으면 `null`. `metadata.managedFields`와 적용 기록 annotation은 뺀다 |
| `raw.k8s.events` | `involvedObject`가 대상 슬롯 리소스인 이벤트 원본 (없으면 `[]`) |
| `raw.k8s.status` | `render`일 때 server-side apply dry-run에 k3s API가 돌려준 Status 원본(필수), 그 밖에는 `null` |
| `errorMessage` | 사람이 읽는 오류 한 줄. `render`면 Status의 `message`를 그대로 넣는다. `verify`면 통과하지 못한 검사 하나(요청한 경로와 응답 상태, 또는 Ready가 아닌 Pod · 엔드포인트가 빈 Service)를 적고, `raw.k8s`에는 그 서비스의 Pod와 이벤트를 넣는다 |
| `logs` | 오류 시각 10분 전부터, 최대 200줄. 재시작한 Pod는 직전 컨테이너 로그. `apply` · `verify`는 파이프라인이 보내지 않으면 플랫폼 서버가 대상 슬롯 Pod에서 읽어 채운다(읽지 못하면 빈 줄, [API 계약](api.md) "파이프라인 ↔ 플랫폼 서버" 3번) |
| `previous` | 직전 티켓. 없으면 `null`. `status`는 `verified` · `pr_opened` · `needs_user` · `gave_up`(그 티켓의 해결 결과) 또는 `stopped`(결과 없이 끝남) |

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
          "path":  { "type": "string", "pattern": "^/spec/(services/[0-9]+/(build|runtime)/|services/[0-9]+/name$|project/slug$)" },
          "value": {}
        }
      }
    },
    "buildOverrides": {
      "type": ["object", "null"],
      "description": "verified를 낸 빌드에 쓴 CodeBuild override. 플랫폼은 빌드를 재사용해 다시 실행하므로 기록용이다",
      "properties": {
        "computeType":    { "type": "string" },
        "timeoutMinutes": { "type": "integer", "maximum": 20 },
        "image":          { "type": "string" },
        "cache":          { "type": "boolean" }
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
| `verified` | `specPatch` (재실행만 했으면 빈 배열) | `specPatch` 검증(이 티켓에서 같은 패치로 `run_deploy` → `run_verify` 통과) → 실행 기록 입력에 저장 → 배포 대기열에 다시 세움 → 차례에 고친 입력으로 `student-deploy`를 처음부터 다시 실행(Build는 재사용, Verify가 재확인) → Switch → W7. 다시 실패하면 새 티켓(실행 기록당 3개까지). [API 계약](api.md) "파이프라인 ↔ 플랫폼 서버" 5번 |
| `pr_opened` | `pr` | 사용자 머지 대기. 머지되면 새 커밋으로 W0부터 |
| `needs_user` | `userRequest` | 사용자에게 요청 |
| `gave_up` | `summary` | 보고 |

- `JSON Patch`(RFC 6902) 경로의 모양은 `build` · `runtime` 전체와 `name` · `slug`까지 받지만, 게이트웨이는 `name` · `slug` 수정을 늘 `PATCH_FORBIDDEN`으로 거절한다.
- `summary`는 다음 티켓의 `previous.summary`로 쓴다.
- PydanticAI 에이전트의 출력 타입을 이 스키마의 Pydantic 모델로 두어, 모양이 틀린 결과는 에이전트 안에서 다시 만들게 한다.

### 7. 종료 알림

```json
{ "ticketId": "t_0013", "commitSha": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", "reason": "success" }
```

| `reason` | 언제 |
|---|---|
| `success` | `verified` 뒤 다시 실행이 Verify(재확인) · Switch · W7까지 성공 |
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
  "match": { "all": [
    { "path": "raw.k8s.events[*].reason", "equals": "Unhealthy" },
    { "path": "raw.k8s.events[*].message", "regex": "(Readiness|Startup|Liveness) probe failed" }
  ] },
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
  - 조건 하나는 `{ "path", 시험 하나 }`이고 시험은 `equals` · `notEquals` · `regex` 중 하나다. 경로가 가리키는 값 하나라도 맞으면 참이다(`[*]`는 배열 전체, `[0]`은 한 칸, 없는 칸은 거짓). `regex`는 문자열 값에만 댄다.
  - 조건은 `{ "all": [...] }` · `{ "any": [...] }`로 묶는다. `all` 안의 조건은 서로 다른 원소에서 맞아도 된다(같은 이벤트인지 보지 않는다).
  - 코드 분류는 티켓의 `stage`와 같은 case만 파일 순서대로 대조해 처음 맞는 것을 고른다. 그래서 좁은 case를 넓은 case 앞에 둔다(`A3` OOMKilled는 `A2` CrashLoopBackOff 앞).
  - 초기 case 데이터는 [`AI/ai_server/agent/cases.json`](../../AI/ai_server/agent/cases.json)이다. `playbook`의 `when`과 `{i}` 같은 자리 표시는 에이전트에게 주는 설명이고 코드가 판정하지 않는다. playbook의 `tool`은 게이트웨이가 여는 도구만 쓴다(테스트가 확인한다). `submit_result` 단계는 모델에게 도구가 아니라 끝내는 조건(`finish`)으로 보인다(결과는 코드가 낸다).
  - `verify` stage의 case는 `V1` · `V2`다. `verify` 티켓에는 검사 결과 원본이 없으므로 `errorMessage`(통과하지 못한 검사 하나의 경로와 응답 상태)를 정규식으로 대조한다. 그 밖의 `verify` 실패(Ready 아닌 Pod, 빈 엔드포인트, 404가 아닌 상태)는 정규식 힌트 없이 ② 분류로 간다.
  - `stats`(`hits` · `solved`)는 AI 서버 메모리에만 있어 재시작하면 0부터다.
- planning으로 해결한 새 case는 바로 넣지 않는다. 사람이 확인한 뒤 넣는다.

**초기 case** (개인 · 소규모 팀의 Node 웹 프로젝트 기준 추정. 실패 주입 시험으로 고친다)

| case | 단계 | 오류 | 신호 | 처리 |
|---|---|---|---|---|
| `B1` | build | 락 파일 불일치 | `INSTALL` 실패, `ERR_PNPM_OUTDATED_LOCKFILE`, `npm ci` sync 오류 | `needs_user`로 다시 만들 락 파일과 명령을 알림(락 파일은 패키지 매니저를 돌려야 다시 만들 수 있고 `edit_repo_file` 50줄을 넘기 쉽다) |
| `B2` | build | Node 버전 불일치 | `engine "node" is incompatible`, `ERR_PNPM_UNSUPPORTED_ENGINE`, `npm error code EBADENGINE`. npm의 `EBADENGINE` **경고**와 일반 `SyntaxError`는 신호로 쓰지 않고, 대조는 `B5` · `B3` · `B4` 뒤에 한다(경고가 섞인 다른 실패를 B2로 잘못 고르지 않게, 2026-11-14) | `build.nodeVersion` |
| `B3` | build | 빌드 시점 env 누락 | `BUILD` 실패, `import.meta.env.VITE_*` undefined | `build.buildEnv` 또는 사용자 요청 |
| `B4` | build | 대소문자 · import 경로 | `Module not found`, `Cannot find module` | 수정 PR(`edit_repo_file`의 `find`에 지금 import 줄, `replace`에 고친 줄 → 같은 `source`로 `run_build` · `run_deploy` → 인자 없이 `run_verify` → 같은 `source`로 `open_pr`). `BOT_UNAVAILABLE`이거나 PR이 막히면(`patchAttached`) `needs_user`로 import 파일 · 고칠 경로를 알림 |
| `B5` | build | `COPY` 대상 없음 | `COPY failed`, `"/dist": not found` | `build.context` · `outputDir` · `dockerfile` |
| `P1` | prepare | 필수 Secret key 없음 | W3 상태 "빠짐" | 사용자 요청 |
| `P2` | prepare | 자원 합계 초과 | 검증 규칙 `resources` 합계 | `runtime.resources` |
| `P3` | prepare | `ingressPath` 충돌 | 검증 규칙 `ingressPath` | `runtime.ingressPath` |
| `R1` | render | 이름 규칙 위반 | `422 Invalid`, `FieldValueInvalid`, `DNS-1035` | 사용자 요청(`needs_user`). `name` · `slug`는 대상 슬롯에서 시험할 수 없어 게이트웨이가 `PATCH_FORBIDDEN`으로 막는다. 배포 입력 검사(`SERVICE_NAME`)가 이미 같은 규칙이라 실제로는 거의 오지 않는다 |
| `R2` | render | 포트 · probe 값 오류 | `422 Invalid`, field `...containerPort` | `runtime.port` · `health` |
| `R3` | render | 쿼터 초과 | `403 Forbidden`, `exceeded quota` | `runtime.resources`. render에서는 드묾: ResourceQuota는 Pod가 생길 때 걸려 Deployment dry-run은 통과한다(2026-11-11 로컬 k3s, CPU 9 Deployment가 통과). 실제로는 Prepare의 `P2`나 apply의 `A4`(FailedCreate)로 온다 |
| `A1` | apply | 헬스체크 실패 | 이벤트 `Unhealthy` | `runtime.port` · `health.path` · `startupTimeoutSeconds` |
| `A2` | apply | 시작 직후 종료 | `CrashLoopBackOff`, `exitCode` ≠ 0 | 로그 패턴: env 누락 → `runtime.env`, 코드의 파일 · 모듈 경로 오류(`ENOENT`, `Cannot find module`) → B4와 같은 수정 PR(`find` · `replace`), DB 연결 실패 → 사용자 요청 |
| `A3` | apply | 메모리 초과 | `OOMKilled` (137) | `runtime.resources.memory` |
| `A4` | apply | Pod 생성 실패 (쿼터) | ReplicaSet 이벤트 `FailedCreate` + `exceeded quota` | `runtime.resources` |
| `V1` | verify | 정적 파일 404 | `errorMessage`에 파일 경로(`/assets/` 또는 `.js` · `.css` · 이미지 · 글꼴 확장자)와 `404` | 원인은 Vite `base` · `outputDir` 경로. spec(`build.outputDir`)이면 `specPatch`, 레포 파일(`vite.config`의 `base`)이면 수정 PR(수정 PR 도구 전에는 `needs_user`로 고칠 파일 · 값을 알림) |
| `V2` | verify | API 경로 404 | `errorMessage`에 경로 세그먼트 `/api` · `/health(z)` · `/ready(z)` · `/live(z)`와 `404` (`/healthcare` · `/api-docs`는 아님) | `runtime.stripPrefix` · `ingressPath` · `health.path` |

에이전트를 부르지 않는 플랫폼 문제: CodeBuild API 오류(`AccountLimitExceededException` · `InvalidInputException` · `ResourceNotFoundException`), GHCR push 거부, `ImagePullBackOff` · `ErrImagePull`, `FailedScheduling`(노드 자원 부족), 차트 렌더 실패, 검사 규칙 거부, live 슬롯 보호 중단, 네임스페이스 · Secret 없음.

### 9. 모델

| 쓰는 곳 | 모델 |
|---|---|
| ③ 계획 실행(도구 부르기 · 인자 채우기 · 학생에게 보일 글) | 로컬 Qwen3-8B (리더 vLLM, OpenAI 호환 API) |
| ② 분류, ③ 계획, ④ · ⑤ planning | 추론 모델 `gpt-6.1-sol` (충북대 NOVA API Gateway, OpenAI 호환. [ADR-016](../adr/016-planner-model-nova-gateway.md), [배포 워크플로우](deploy-workflow.md) §7) |

PydanticAI에서 두 모델을 OpenAI 호환 provider로 붙이고, 추론 모델 API를 못 쓰면 로컬 모델로 넘긴다.

### 10. AI 서버 구현 (`AI/ai_server/agent/`)

| 단계 | 모델 | 하는 일 |
|---|---|---|
| ① 정규식 대조 | 없음 | §8 `match`로 같은 stage에서 맞는 case를 **전부** 고른다(`CaseMemory.candidates`). 최종 판단에 쓰지 않고 ②에 `Regex hint (may be wrong)`로만 준다 |
| ② 분류 | 추론 API | 같은 stage의 case 목록(id · 제목)과 ①의 힌트로 하나를 고르거나 null. 힌트가 로그 발췌와 다르면 발췌를 따른다. 목록에 없는 id는 모르는 것으로 본다. 고른 case에 hits를 올린다. 결과의 `method`는 `llm` |
| ③ 계획 → 실행 | 추론 API → 로컬 | 추론 모델은 읽기 도구(`read_repo` · `get_target_status` · `read_pod_logs`)만 불러 증거를 본 뒤 계획(`cause` + `steps`: 도구 · 실제 인자 · `when`, 마지막은 끝내는 조건)을 낸다. `edit_repo_file`의 `find`에는 읽은 파일의 지금 글을 그대로 적는다(파일 전체 `content`도 받는다)(2026-11-14 운영 B4: 읽지 못해 "읽고 `needs_user`"로 계획했다). 읽기는 게이트웨이 호출 한도에 세고, 기록(`actions`)에 남고, 가림 필터를 거쳐 추론 API로 간다. 읽기 거절은 재계획이 아니라 추론 모델에 돌려준다. 계획 중에는 지난 읽기 결과를 한 줄로 줄이지 않는다(추론 API가 실패해 로컬로 넘어가면 16K를 넘을 수 있다). 추적 로그는 `plan done reads=<도구 이름들>`만 남긴다. 게이트웨이에 없는 도구 · 8,000자를 넘는 계획 · `edit_repo_file` 단계 인자 맨 위에 `path` · `find` · `replace` · `content`가 있거나 `files`가 목록이 아닌 계획(인자 모양은 `{ files: [{ path, find, replace }], message }`, 인자 없는 단계와 placeholder 글은 둔다; 2026-11-14 운영 D10: `files` 없이 불러 `INVALID_ARGUMENT`)은 다시 만들게 한다. 로컬 모델은 계획에 있는 도구만 받아 그대로 부르고 해결 결과(§6의 status · `specPatch` · `pr` · `userRequest` · `evidence` · `summary`)를 낸다 |
| ④ 재계획 | 추론 API | ③이 `gave_up`이거나, 실행 중 게이트웨이 거절(같은 호출 반복 `REPEATED_CALL` 포함)을 받았거나, 출력이 계속 깨지면 playbook · 지금까지의 도구 호출 · 멈춘 이유를 받아 다시 계획하고 직접 실행한다 |
| ⑤ planning | 추론 API | ②가 null이면 처음부터 계획하고 직접 실행한다 |

- **결과는 코드가 낸다.** 모델에게 `submit_result`를 주지 않는다. 모델의 출력(위 ③의 칸들)이 모양에 맞지 않으면 PydanticAI가 다시 만들게 하고(2번까지), 코드가 봉투(`ticketId` · `commitSha` · `classification` · `actions`)를 붙여 게이트웨이 `submit_result`를 한 번 부른다. `actions`는 모델이 말한 것이 아니라 게이트웨이에 실제로 한 호출의 기록이다(`ok`는 결과의 `ok`, 거절은 `ok: false`와 `rejected <code>`).
- **거절 코드.** `TOOL_LIMIT` · `TIME_LIMIT` · `LIVE_SLOT_PROTECTED`는 실행을 멈추고 이유와 할 일을 담은 `gave_up`을 낸다(재계획하지 않는다). `TICKET_CLOSED`는 토큰이 무효라 아무것도 내지 않는다. ③에서 로컬 모델이 받은 그 밖의 거절은 모델에 돌려주지 않고 그 자리에서 ④로 간다(2026-11-14 실측: 로컬 모델이 거절된 호출을 되풀이하다 `TOOL_LIMIT`). ④ · ⑤에서 추론 모델이 받은 거절은 코드와 메시지를 돌려줘 인자를 고치게 한다.
- **왜 이렇게 나눴나**(2026-11-14 실서비스 실측, [ADR-017](../adr/017-planner-plans-local-executes.md)). 예전에는 ①이 맞으면 그 case로 분류가 끝났고, 못 맞추면 로컬 모델이 case를 골랐으며, case가 정해지면 로컬 모델이 playbook의 계획과 도구 호출을 모두 했다. 실측 9건에서 로컬 모델은 playbook에 없는 실패 5건을 모두 엉뚱한 case(B1 · B2 · B4)로 골랐고, 9건 중 7건이 도구를 부르기 전에 계획이 틀렸다(정답 0/9).
- **모델 호출 실패**(연결 실패, 출력이 계속 틀림)는 `gave_up`과 그 사실을 적은 `summary`로 낸다. 그럴듯한 결과로 대신하지 않는다. 게이트웨이 거절이 반복되어 도구 재시도 한도(3번)를 넘긴 것은 모델 실패가 아니라 "배포 설정 수정이 플랫폼 검사에서 계속 거절되어 멈췄습니다(마지막 거절: <code>)"로 알린다.
- **게이트웨이 장애**: 연결 실패 · 도구 호출 중 전송 오류 · 시간 초과는 "플랫폼 게이트웨이에 닿지 못해 멈췄습니다"라는 `gave_up`으로 바꾼다. 결과 제출이 전송 오류면 2 · 5 · 10초 뒤 다시 낸다(모두 4번). `TICKET_CLOSED`가 아닌 코드(`INVALID_RESULT` · `PATCH_FORBIDDEN` · `INVALID_SPEC` 등)로 거절되면 모델이 정한 칸을 빼고 봉투와 사실 요약만 담은 `gave_up`으로 한 번 더 낸다(경고 로그에 거절 코드와 가린 이유). `TICKET_CLOSED`면 다시 내지 않는다. 그래도 안 되면 로그만 남고, 플랫폼은 게이트웨이 토큰이 만료되고 2분 뒤 대기열 타이머가 `failed`(`TIMED_OUT`)로 마감한다.
- **모델 설정이 없으면**(`LOCAL_MODEL_*` 비움) 서버는 뜨고, 티켓마다 코드 분류만 한 뒤 "AI 모델 설정이 없어 문제 해결을 하지 않았습니다"라는 `gave_up`을 낸다.
- **가림 필터**(FR-102): 추론 모델 API로 가는 요청의 지시문 · 프롬프트 · 도구 결과 · 이전 도구 인자에서 비밀값 같은 키의 값, Authorization 헤더 값, 주소 안의 비밀번호, 모양으로 아는 토큰(GitHub · OpenAI · AWS · Slack · Supabase · 게이트웨이 · JWT · 개인 키)을 `[REDACTED]`로 바꾼다. 로컬 모델은 클러스터 안이라 걸지 않는다. 게이트웨이로 내는 결과의 기록은 원본이다.
- **모델 연결**: 두 모델 모두 OpenAI 호환 API이고 env로 받는다(`LOCAL_MODEL_*` · `PLANNER_MODEL_*` 모두 선택, 주소와 이름은 함께). 추론 API가 없으면 ② ~ ⑤ 모두 로컬 모델이 하고, 있는데 호출이 실패하면 그 요청은 로컬 모델로 넘어간다.
- **모델로 보내는 글**은 `prompts.py` 한 곳에서 만든다.

**로컬 모델 16K 컨텍스트 예산** (`AI/ai_server/agent/budget.py`). vLLM `--max-model-len 16384`는 입력 + 출력의 합이라 입력은 약 10K 토큰을 목표로 한다. 플랫폼이 보내는 크기에 기대지 않고 AI 서버가 받는 쪽에서 줄인다.

| 어디서 | 무엇을 |
|---|---|
| 티켓을 받을 때 | 로그 한 줄 400자(넘으면 `…[truncated N chars]`), 로그 전체 24KB(넘으면 앞줄부터 버린다). `raw.codebuild` · `raw.k8s.pod` · `raw.k8s.events` · `raw.k8s.status`가 각각 6,000자를 넘으면 필요한 칸만 남긴다(Pod: 이름 · phase · 컨테이너 상태 · 직전 종료 · 재시작 횟수, builds[0]: buildStatus · phase별 상태와 메시지, Status: code · reason · message · causes, 이벤트: type · reason · message · 대상, 최근 50개). 코드 분류(①)는 자르기 전 원본으로 한다 |
| 프롬프트 | 티켓 JSON 대신 요약본을 넣는다: 단계 · 서비스 · 슬롯 · `errorMessage` · 직전 티켓 · 받을 때 자른 사실 · 배포 spec(4,000자까지) · 빌드의 실패 phase · Render Status · 컨테이너 상태 · 이벤트(reason · message, 같은 것은 한 번, 최근 10개) · 로그 발췌(오류 표시 줄의 앞뒤 2줄 + 마지막 20줄, 합쳐 최대 60줄, 줄마다 200자). 추론 모델에도 같은 요약본을 준다. 추론 API가 실패하면 그 요청이 로컬 모델로 넘어가기 때문이다. 더 필요한 것은 관찰 도구로 읽는다 |
| 게이트웨이 도구 결과 | 로그(`lines` · `logTail`)는 같은 발췌, 이벤트는 같은 규칙으로 최근 10개, Pod · builds[0] · Status는 크면 필요한 칸만. 줄인 것은 결과의 `_truncated`에 적는다. 해결 결과의 `actions` 기록은 줄이기 전 원본에서 만든다 |
| 대화 기록 | 가장 최근 도구 결과만 전체로 두고, 그 이전 결과는 한 줄 요약(도구 · 짧은 값 칸 · 목록 길이)으로 바꾼다(PydanticAI history processor) |
| 모델 설정 | 로컬 모델이 계획을 실행할 때(도구 부르기): Qwen3 생각 모드 끔(요청 본문 `chat_template_kwargs: {"enable_thinking": false}`), `max_tokens` 2048. 로컬이 분류 · 계획까지 맡을 때(추론 API 없음 · 실패): 생각 모드 켬, `max_tokens` 4096 |

## 알려진 한계

- 학생 DB 자체의 문제(테이블 없음, migration 안 함)는 에이전트가 학생 DB에 닿지 못해 고칠 수 없다. `needs_user`로 넘긴다.
- 초기 case 목록과 신호는 추정이다. 2026-11-14에 실패를 심은 레포의 9건을 실서비스에서 한 번씩 돌려 봤다(정답 3/9, [ADR-017](../adr/017-planner-plans-local-executes.md), [`ai-scope.md`](../ai-scope.md)). 한 번씩이라 해결률의 범위는 검증하지 않았다.
- `V1` · `V2`는 `errorMessage` 문구로 대조한다. 그 문구는 파이프라인 Verify(F05)가 만든다. 정한 모양은 요청 실패 `<service>: GET <path> -> <status>`(응답 없음은 `-> error: <원인>`), Ready 실패 `<service>: not ready (<reason>)`, 빈 엔드포인트 `<service>: no endpoints`이고 테스트도 이 모양으로 했다. F05가 실제로 이렇게 내는지는 F05 머지 뒤 맞춰 봐야 한다.
- `render` case(`R1` ~ `R3`)는 `raw.k8s.status`(코드 · `message` · `details.causes`)로 대조한다. `prepare` case(`P1` ~ `P3`)는 Status가 없어 `errorMessage` 문장으로 대조하므로, 플랫폼 서버가 쓰는 실제 문장으로 정규식을 맞춰야 한다.
- CodeBuild API의 오류 이름 · phase 값은 AWS 문서와 대조하지 않았다.
- 로컬 8B 모델이 계획을 어기지 않고 도구를 부르는지는 실서비스 9건을 한 번씩 돌린 결과뿐이다([ADR-017](../adr/017-planner-plans-local-executes.md)). 분류 · 계획은 추론 모델이 하므로 로컬 모델의 분류 품질은 더 이상 쟁점이 아니다.
- 컨텍스트 예산은 글자 수로 어림했다(가장 큰 시험 티켓 · 도구 결과로 로컬 모델 입력이 도구 정의까지 합쳐 30,000자 이하). 실제 토큰 수는 vLLM에 붙인 뒤 응답의 `usage.prompt_tokens`로 재야 한다. 한글은 글자당 토큰이 더 많아 어림이 빗나갈 수 있다.
- 요약본과 발췌는 정보를 버린다. 오류 표시 단어가 없는 원인 줄은 발췌에서 빠질 수 있고, 지난 도구 결과는 한 줄만 남는다. 에이전트가 필요하면 관찰 도구로 다시 읽는다.
- 결과를 내기 직전에 코드가 게이트웨이 검사(`BE/src/gateway/result.ts` · `tools.ts`)에 맞춘다: `verified`가 아니면(`pr_opened` · `needs_user` · `gave_up`) `specPatch` · `buildOverrides`를 뺀다(있으면 비어 있어도 `INVALID_RESULT`). `pr_opened`의 `pr.url`은 이 티켓의 `open_pr`가 돌려준 주소로 채운다. 2026-11-14 실측에서 `pr_opened` 6건이 모두 `INVALID_RESULT`로 거절되어 최소 `gave_up`이 된 것을 보고 넣었다. 거절되면 그 이유를 AI 서버 경고 로그에 남긴다.
- `verified`의 패치가 env · buildEnv에 넣는 값이 티켓 · 도구 결과 어디에도 없으면 AI 서버 코드가 `needs_user`로 바꾼다(지어낸 값. 모델은 비밀값을 모른다). 2026-11-14 실서비스 측정에서 로컬 모델이 비밀값 `VITE_API_KEY`에 지어낸 값을 넣어 시험을 통과시키고 `verified`를 낸 것을 보고 넣었다(`loop._invented_env_keys`).
- 에이전트가 낸 `verified`가 정말 `run_verify` 통과 뒤인지 AI 서버는 따로 확인하지 않는다. 게이트웨이가 이 티켓의 시험 기록(같은 `specPatch`로 `run_deploy` → `run_verify` 통과)과 맞춰 보고(B2), 다시 실행의 Verify가 대상 슬롯을 한 번 더 확인한다(§1).
- 가림 필터는 정해진 모양만 가린다. 이름 없이 나온 임의의 비밀 문자열은 못 가린다.
- 게이트웨이가 지금 여는 도구는 열 개다: 관찰 셋(`get_target_status` · `read_pod_logs` · `read_repo`), 시험 넷(`run_build` · `run_render` · `run_deploy` · `run_verify`, F11b), 레포 수정 둘(`edit_repo_file` · `open_pr`, F13), `submit_result`. `verified`는 이 티켓에서 같은 `specPatch`로 `run_deploy` → `run_verify`를 통과했을 때만 받는다(B2). 빌드 값을 고쳤으면 그 서비스의 `run_build`도 같은 패치로 통과했어야 한다(B3). 그래서 지금 에이전트가 낼 수 있는 결과는 `verified` · `needs_user` · `gave_up` · `pr_opened`이다.
- 수정 PR(F13, FR-077)은 게이트웨이(`BE/src/gateway/repo-edits.ts` · `bot-repo.ts`)가 봇 계정 `wanggane-bot`으로 한다. 토큰(`BOT_GITHUB_TOKEN`, classic PAT `public_repo`, 2026-12-10 만료)은 BE에만 있고 AI 서버에는 가지 않으며, 비어 있으면 `edit_repo_file` · `open_pr`은 `BOT_UNAVAILABLE`로 거절한다. 바뀐 줄은 지운 줄 + 넣은 줄이고(한 줄을 고치면 2줄), 파일 5개 · 50줄은 호출마다가 아니라 티켓 전체 기준이다(같은 티켓에서 다시 부르면 앞서 고친 것에 이어 쌓는다). 비밀값 검사는 값의 모양(토큰 · 키 · 인증 헤더 · 주소 속 비밀번호)만 보고, 이름만 민감한 줄(`"jsonwebtoken": "^9"`)은 막지 않는다. `pr_opened`는 `open_pr`이 이 티켓에 돌려준 주소와 같을 때만 받는다. 이 기능은 가짜 GitHub 응답과 가짜 GoCD로만 자동 테스트했고, **실제 GitHub · 실제 봇 토큰 · 실제 CodeBuild로는 돌려 보지 않았다(미검증)**: 이미 있는 fork에 fork 요청을 다시 보내면 그 fork가 돌아오는지, 봇 fork에서 학생 레포의 commit으로 git tree를 만들 수 있는지, CodeBuild의 `git fetch`가 fork의 commit SHA를 받는지, 로컬 모델이 `source`를 이어 넘기는지는 확인하지 않았다. 수정 기록(작업 브랜치 · 이 티켓의 commit)은 BE 메모리에 있어 서버가 다시 뜨면 이어 쓰지 못한다. 비공개 레포는 fork할 수 없다(`BOT_UNAVAILABLE`, 제출 단계에서 공개 레포만 받는다, [ADR-002](../adr/002-bot-account-for-fix-prs.md)). 한 `source`로 여러 서비스의 빌드 입력이 바뀌면(예: be의 빌드 컨텍스트가 레포 전체) `run_build`는 대상이 아닌 서비스 자리를 실행 기록의 이미지로 채워(빌드 단계는 reuse 서비스를 건드리지 않는다) 하나씩 빌드할 수 있게 한다. 그 서비스에 실행 기록의 이미지도 없으면(한 번도 빌드를 통과하지 못함) 그 서비스를 먼저 빌드해야 하고, 두 서비스 모두 이미지가 없으면 빌드할 수 없다.
- 시험 실행은 게이트웨이 쪽(F11b: `run_build` · `run_render` · `run_deploy` · `run_verify`, `BE/src/gateway/trials.ts` · `tools.ts`)과 파이프라인 쪽의 Switch CLI `TRIAL_ID` 가드 · Build CLI `buildOverrides` 받기를 구현했다. 결과를 모아 보내는 `trial-report`, 입력 task의 시험 분기(`?counter`, `build-overrides.json`), 시험 파이프라인 정의(`Infra/gocd/student-trial.gocd.yaml`)도 구현했다. 운영 GoCD의 `student-trial`로 `run_render` · `run_deploy` · `run_verify`가 한 번씩 통과했다(2026-11-14 3차 리허설, [`ai-scope.md`](../ai-scope.md)). `run_build`와 시험이 실패하는 경로는 가짜 GoCD 응답으로만 시험했다. 시험 기록과 기다림은 플랫폼 서버 메모리에 있어, 서버가 다시 뜨면 기다리던 `run_*` 호출은 끊긴다(에이전트는 게이트웨이에 닿지 못한 것으로 본다). `name` · `slug`는 슬롯 · Secret 이름이 따라 바뀌어 시험할 수 없어 `PATCH_FORBIDDEN`이다. 빌드 값을 고친 서비스의 해시는 같은 commit의 GitHub 트리로 다시 계산한다(배포 입력을 만들 때와 같은 규칙, 가짜 응답으로만 시험했다). `verified` 뒤에는 고친 입력으로 배포 파이프라인을 처음부터 다시 실행한다(B2, 가짜 GoCD로만 자동 테스트했다).
- 티켓 하나의 전체 시간은 시험 대기를 포함해 60분이 상한이다(에이전트 작업 15분은 대기를 뺀 시간). `build` 스테이지 티켓은 `run_build`로 고쳐 본다(통과한 이미지가 이 티켓의 시험 이미지가 되고 `build_cache`에도 남는다).
- `student-trial` 하나를 모든 프로젝트가 같이 쓰고 리더 실행기는 하나(`Infra/executor/agent.yaml`의 `replicas: 1`)라 시험과 배포가 한 줄로 선다. 데모처럼 여럿이 동시에 쓸 때 시험 대기 30분 안에 드는지는 확인하지 않았다.
- 티켓 한도(3개)는 실행 기록마다라 프로젝트 전체로는 한도가 없다(새 배포마다 새로 3개). 프로젝트 단위 한도는 별도 이슈로 논의한다.
- 게이트웨이의 호출 횟수 · 작업 시간은 플랫폼 서버 메모리에서 센다: 전체 20회, 같은 호출 연속 2회, 도구별 횟수(§3 표, 지금 열린 `run_build` 2 · `run_render` 5 · `run_deploy` 2 · `run_verify` 3 · `edit_repo_file` 5 · `open_pr` 2), 작업 15분(첫 호출부터, 시험 대기는 진행 중인 것까지 뺀다), 티켓 전체 60분(대기 포함). 서버가 다시 뜨면 그 티켓은 처음부터 다시 세고, 티켓 시작은 저장된 만료 - 60분으로 보수적으로 잡아 남은 만료까지만 쓴다.
- `read_repo`는 인증 없이 GitHub API를 부른다(서버 IP당 시간당 60번, 레포 소유 확인과 같이 쓴다). 한도에 닿으면 도구 오류로 끝난다.
- 게이트웨이에 끝내 닿지 못하거나, AI 서버가 실행 중 예외로 멈추거나 다시 떠서 티켓을 잊으면 결과를 낼 길이 없다. 계약에 다른 길(콜백 · 재전송 요청)이 없어서, 플랫폼은 게이트웨이 토큰이 만료되고 2분 뒤 대기열 타이머(15초 간격)가 `failed`(`TIMED_OUT`, 실패했던 스테이지)로 마감하고 티켓을 `stopped`로 닫는다. AI 서버에는 로그만 남는다.
