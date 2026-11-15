# ADR-018: 배포가 끝나면 플랫폼이 가진 기록으로 추론 모델을 한 번 불러 학생용 배포 설명을 만들고, 배포 상태와 분리해 보인다

- **상태**: 유효
- **날짜**: 2026-11-15
- **결정자**: 김현식 제안(2026-11-15), 이 PR의 팀원 승인으로 확정
- **관련**: SRS `FR-105` · `UC-08`, [ADR-009](009-deploy-runs-on-leader-gocd-agent.md), [ADR-011](011-deploy-slots-a-b.md), [ADR-012](012-agent-acts-through-platform-gateway.md), [ADR-016](016-planner-model-nova-gateway.md), [ADR-017](017-planner-plans-local-executes.md), [배포 설명 설계](../design/deploy-explain.md), [`ai-scope.md`](../ai-scope.md), [NOVA API Gateway Chat Completions 레퍼런스](https://docs.mindlogic.ai/docs/cbnu-ac/api-gateway/reference/chat-completions)

## 맥락

학생은 배포 화면에서 스테이지 라벨과 고정 실패 문장만 본다. 빌드 · 렌더 · 적용 · 확인 · 전환이 각각 무엇을 했고, 실패했다면 왜 실패했는지 처음 배포하는 학생은 알기 어렵다. 플랫폼은 이미 설명에 쓸 재료를 가지고 있다. 실패 티켓(BE `sendTicket`, 비밀값 필터를 거친 오류 문장 · 로그 꼬리 · Pod · 이벤트 요약), 배포 입력(`deploy_runs.input`의 spec · 서비스별 build run/reuse), 대상 슬롯, 첫 배포 여부, AI 에이전트 결과(`agent_result`)다. 성공한 verify 리포트는 BE로 오지 않는다(`Infra/pipeline/src/notify.ts` `mapReport`). 파이프라인은 GoCD가 레포 checkout에서 바로 빌드해 돌리므로(`Infra/gocd/job.sh`), 파이프라인을 바꾸면 머지 즉시 모든 배포의 알림 경로에 들어간다. 마감(2026-11-15 18:00 KST 프리즈)이 가깝다.

## 결정

- 재료는 BE가 이미 가진 값에서 화이트리스트로 모은다. 파이프라인 · GoCD · 아티팩트는 바꾸지 않는다. 자유 글(오류 문장 · 로그 · 이벤트 · 빌드/시작 명령 · 에이전트 글)에 내부 이름 가림(정규식) → BE 비밀값 필터(`redact`) → AI `RedactingModel`을 거친 값만 밖으로 나가고, 응답에도 같은 필터를 다시 건다. env 값과 비밀값 이름은 보내지 않고 개수만 보낸다.
- AI 서버에 동기 엔드포인트 `POST /agent/explanations`를 두고, 배포 하나에 추론 모델(ADR-016의 `gpt-6.1-sol`)을 한 번 부른다. 도구 없이 PydanticAI `NativeOutput`(Chat Completions `response_format` json_schema, `strict: true`)으로 받고 `reasoning_effort`(env `EXPLAIN_REASONING_EFFORT`, 기본 `medium`)를 보낸다. 도구와 함께 보내면 게이트웨이가 `reasoning_effort`를 빼고 재시도하므로, 추론 강도를 실제로 쓰려면 도구가 없어야 한다. 로컬 모델(Qwen)은 쓰지 않는다(ADR-017의 역할 분담: 요약 · 판단은 추론 모델, 로컬은 도구 실행).
- BE는 배포가 끝난 뒤(ended 이벤트) 비동기로 부르고 기다리지 않는다. 배포 상태 · 대기열 · 티켓 · 알림은 설명 성공 여부와 무관하다. 설명은 BE 메모리에 보관하고(`AgentProgress`와 같은 방식) 진행 상태 응답의 선택 칸 `explanation`으로 보인다. DB 마이그레이션은 하지 않는다. 설명이 없으면(꺼짐 · 실패 · 재시작) FE가 정적 단계 설명을 보이고, 그것을 AI 설명이라 부르지 않는다.
- BE env 플래그(`DEPLOY_EXPLAIN_ENABLED`, 기본 꺼짐)로 켜고 끈다. 끄면 지금과 같다.
- 플랫폼 문제로 끝난 실패(티켓이 가지 않은 실패, AI 서버가 티켓을 받지 못한 `AGENT_UNAVAILABLE` 포함)는 설명을 만들지 않는다.
- 기존 ADR(특히 ADR-012 · 016 · 017)은 바꾸지 않는다. 에이전트 루프 · MCP 게이트웨이 도구 · `submit_result` 계약은 그대로다. ADR-016을 고치는 일(게이트웨이 structured output · reasoning_effort 반영)은 다른 팀원이 별도로 한다.

## 대안

| 대안 | 장점 | 버린 이유 |
| --- | --- | --- |
| 파이프라인이 성공 리포트(verify 요청 목록 · 렌더 요약)를 BE로 보낸다 | 성공 설명의 근거가 풍부하다 | 파이프라인 변경이 머지 즉시 모든 배포에 들어가고, 알림 본문 버그는 `STAGE_NO_REPORT`로 배포를 실패시킨다. MVP 이후로 미룬다 |
| AI 에이전트의 `submit_result` summary를 늘려 설명으로 쓴다 | 이미 AI가 실패 티켓을 받는다 | 성공 경로에는 티켓이 없다. 에이전트 루프와 `submit_result` 계약(ADR-012)을 바꿔야 한다 |
| 출력을 기본 방식(`ToolOutput`, 출력 도구 호출)으로 받는다 | 기존 `incident.py`와 같다 | 게이트웨이가 도구와 함께 온 `reasoning_effort`를 빼서 추론 강도가 적용되지 않는다 |
| NativeOutput이 실패하면 ToolOutput으로 한 번 더 부른다 | 게이트웨이가 structured output을 막아도 설명이 나온다 | 출력 경로가 둘이 되어 테스트 · 원인 파악이 늘어난다. 구조적 실패는 플래그를 켜기 전 스모크 테스트로 먼저 잡는다 |
| 로컬 모델(Qwen)로 만들거나 폴백한다 | 데이터가 밖으로 나가지 않는다 | 요약 · 판단은 추론 모델이 한다는 역할 분담(ADR-017)과 맞지 않는다. 폴백은 정적 설명으로 충분하다 |
| `deploy_runs`에 `explanation` jsonb 칼럼을 추가한다 | 재시작해도 남고 지난 배포에서도 보인다 | 마이그레이션 적용 순서와 저장 실패 처리가 늘어난다. 설명은 배포 직후 화면에서 보는 보조 정보라 MVP에서는 메모리로 충분하다. 보관이 필요해지면 이 대안으로 간다 |
| 기존 jsonb 칼럼(`agent_result`, `input`, `failure`)에 넣는다 | 마이그레이션이 없다 | 의미가 섞인다. `agent_result`가 null이 아니면 진행 상태 응답이 에이전트 카드를 만든다(`toAgent`, 기본 status `gave_up`). `input`은 재실행 입력이고 `failure`는 `{code, stage, service}` 계약이다. `updateRun`은 `updated_at`도 바꾼다 |

## 결과

- 쉬워지는 것: 학생이 이번 배포의 각 단계와 실패 원인을 자기 배포 기준으로 읽는다. 파이프라인 · 상태머신 · DB 스키마를 바꾸지 않아 롤백은 플래그 끄기다.
- 어려워지는 것: 끝난 배포마다 배포 기록 요약이 학교 게이트웨이(mindlogic)와 모델 업체로 한 번 더 나간다. 화이트리스트가 1차 방어이고 정규식 필터는 놓칠 수 있다(ADR-016과 같은 위험). 설명은 BE 메모리에만 있어 BE가 다시 뜨면 사라지고 정적 설명으로 돌아간다. 게이트웨이 사용량 제한(공용 60초당 120회)을 에이전트와 나눠 쓰고, 설명 호출에는 동시 실행 상한이 없다.
- 확인한 것: 게이트웨이 문서로 `response_format` json_schema strict와 `reasoning_effort` 지원을 확인했다. `pydantic-ai-slim` 2.66.0(`AI/uv.lock`)이 `NativeOutput`과 `openai_reasoning_effort`를 요청 본문의 `response_format`(strict, `additionalProperties: false`) · `reasoning_effort`로 보내고 도구를 보내지 않는 것, `RedactingModel`이 설정과 출력 방식을 그대로 넘기는 것을 오프라인 실행으로 확인했다. 실제 게이트웨이 호출, 토큰 수, 지연, 비용은 아직 확인하지 않았다.
- 다시 볼 조건: 스모크 테스트에서 게이트웨이가 structured output이나 `reasoning_effort`를 받지 않을 때(ToolOutput 폴백 검토), 지연이나 비용이 클 때(`low`로 낮추기), 설명을 지난 배포에서도 보여야 하거나 재시작 소실이 문제가 될 때(칼럼 추가), 파이프라인이 성공 리포트를 BE로 보내게 될 때.
