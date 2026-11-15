# 학생용 배포 설명 — 설계

- **상태**: 구현됨 (2026-11-14, 플래그 기본 꺼짐 · 게이트웨이 스모크 테스트 전)
- **관련**: SRS UC-08, FR-105 · [ADR-018](../adr/018-student-deploy-explanation.md) · [ADR-016](../adr/016-planner-model-nova-gateway.md) · [API 계약](api.md) `GET /api/deploys/:id/status`의 `explanation`, `POST /agent/explanations`

## 범위

- 배포가 끝나면(성공 · 실패 · 학생 확인 필요) 이번 배포에서 각 스테이지가 무엇을 했고 무슨 뜻인지, 실패면 그럴듯한 원인과 다음 할 일을 학생에게 한국어로 보인다.
- 플랫폼이 이미 가진 기록만 쓴다. 파이프라인 · GoCD · 아티팩트, 배포 상태머신 · 대기열 · 실패 분류, AI 에이전트 루프 · MCP 도구 · `submit_result`, DB는 바꾸지 않는다.
- 플랫폼 문제 실패(티켓이 가지 않은 실패 — AI 서버가 티켓을 받지 못한 `AGENT_UNAVAILABLE` 포함, 학생 코드가 아닌 실패 코드)는 설명하지 않는다(`skipped`). FE의 기존 안내가 그대로 보인다.
- 로컬 모델로 설명을 만들지 않는다. Discord 배포 결과 메시지에는 붙이지 않는다.

## 설계

| 쓰는 재료 | 어디서 | 빼는 것 |
| --- | --- | --- |
| spec 요약(역할 · 포트 · 공개 경로 · 헬스 체크 · 빌드/시작 명령 · Dockerfile 유무) | `deploy_runs.input.spec` | env 값, 비밀값 이름(개수만) |
| 빌드 run / reuse | `input.deploy_condition.services` | 빌드 입력 해시, 이미지 주소 |
| 대상 슬롯, 첫 배포 여부 | `target_slot`, switch 성공 처리 때 live 슬롯이 있었는지 | — |
| 실패 재료(오류 문장, 로그, 컨테이너 상태 한 줄, 이벤트 `reason: message`, render Status) | 실패 티켓을 보내는 지점(`sendTicket`, 이미 비밀값 필터를 거침) | CodeBuild 원본, Pod spec · metadata |
| 고정 실패 문장 | `failure` code · stage · service | — |
| AI 에이전트 결과 | `agent_result`의 status · summary · evidence | 도구 호출 원본 |

흐름: 파이프라인 알림은 지금과 같다. BE `DeployRunsService`는 재료를 담는 호출(`rememberTicket` · `rememberSuccess`, 던지지 않음)만 더했다. `DeployEvents.onEnded`가 나면 `DeployExplainer`가 곧바로 `pending`을 두고, 기다리지 않는 작업으로 실행 기록을 다시 읽어 요청을 만들고 AI 서버 `POST /agent/explanations`를 부른다. 결과는 배포 id별 BE 메모리(200개, 오래된 것부터 버림)에 `ready` · `failed` · `skipped`로 둔다. 진행 상태 읽기는 끝난 실행에만 그 값을 `explanation`으로 싣는다. FE는 끝난 뒤에도 `pending`이면 3분까지 더 읽고, 없으면 고정 단계 안내를 보인다.

AI 서버는 추론 모델을 한 번, 도구 없이 부른다. 출력은 PydanticAI `NativeOutput(..., strict=True)`(Chat Completions `response_format` json_schema strict, 모든 칸 필수 · `additionalProperties: false`)이고 `reasoning_effort`(env `EXPLAIN_REASONING_EFFORT`, 기본 medium)를 함께 보낸다. 모델은 `RedactingModel(api_model(...))`이라 보내는 글은 가림 필터를 거친다. 실패 · 시간 초과(120초) · 설정 없음은 `503`이고 FE 고정 안내로 넘어간다.

가림 순서: BE 화이트리스트 → 자유 글(오류 문장 · 로그 · 이벤트 · 빌드/시작 명령 · 에이전트 글)에 내부 이름 가림(`maskInternal`: IP · ARN · 레지스트리 · 클러스터 · Tailscale 호스트 · `proj-<slug>` · 플랫폼 라벨, 학생이 정한 서비스 이름 · 경로에는 걸지 않는다) → BE 비밀값 필터(`redact`) → AI `RedactingModel`. 모델 답에도 AI 서버가 비밀값 필터를, BE가 내부 이름 가림과 비밀값 필터를 다시 건다. 프롬프트는 로그 · 이벤트 속 문장을 지시가 아닌 데이터로 다루게 하고, `failure.message` · 에이전트 결과와 모순되지 말고 재료가 없으면 원인을 단정하지 말라고 적는다.

켜고 끄기: BE env `DEPLOY_EXPLAIN_ENABLED`(`true`일 때만, 기본 꺼짐). 꺼져 있으면 리스너를 등록하지 않고 재료도 담지 않으며 `explanation`은 늘 `null`이다. 롤백은 플래그 끄기다.

## 결정과 대안

| 결정 | 이유 | 버린 대안 |
| --- | --- | --- |
| 재료는 BE가 티켓 지점 · 성공 처리 지점에서 담는다 | 파이프라인은 머지 즉시 모든 배포의 알림 경로에 들어간다. 티켓 지점은 학생 문제 실패에서만 불리고 로그가 채워진 뒤이며 이미 비밀값 필터를 거쳤다 | 파이프라인이 설명 재료를 알림에 싣기 |
| 도구 없는 1회 호출 + structured output | 게이트웨이는 도구와 `reasoning_effort`를 같이 받으면 `reasoning_effort`를 빼고 다시 보낸다. 도구가 없어야 추론 강도가 실제로 켜진다 | ToolOutput, 에이전트 루프 재사용 |
| 길이 상한은 코드에서 자른다 | strict 스키마의 `maxLength`를 게이트웨이가 받는지 확인 전이다 | 스키마에 길이 제약 |
| BE 메모리 보관 | 배포 직후 화면에서 보는 보조 정보다. 마이그레이션이 없으면 적용 순서 위험과 `updated_at` · 상태 조건 갱신과의 얽힘이 없다 | `deploy_runs`에 jsonb 칼럼, 기존 jsonb 칼럼에 끼워 넣기(`agent_result`가 있으면 에이전트 카드가 생긴다) |

## 알려진 한계

- BE가 다시 뜨면 설명이 사라진다(`// simple:`). 지난 배포의 설명은 볼 수 없다.
- 성공한 verify 리포트는 BE로 오지 않아 성공 설명은 spec · 슬롯 · 빌드 방식까지만 근거로 쓴다.
- 재시작으로 실패 재료가 사라진 학생 실패는 `evidence: null`로 보내고, 모델이 "기록이 부족하다"고 쓰게 한다.
- 켜기 전 확인: 운영 키로 `response_format`(strict) + `reasoning_effort: "medium"`, 도구 없는 호출을 한 번 보내 200 · 스키마 일치 · 지연 · 토큰을 기록한다. 400이면 켜지 않는다. 지연이 크면 `EXPLAIN_REASONING_EFFORT=low`.
- 실제 k8s 이벤트 · 빌드 메시지에 가림 패턴 밖의 내부 이름(노드 호스트 이름 등)이 있는지 아직 보지 않았다.
