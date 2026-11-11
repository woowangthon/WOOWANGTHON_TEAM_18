-- AI 에이전트가 낸 해결 결과 중 학생에게 보여 줄 칸(status · summary · userRequest · pr · evidence · classification).
-- 도구 호출 원본(actions) · 로그는 저장하지 않는다. 저장 전에 비밀값 필터를 한 번 더 거친다.
-- 계약: docs/design/api.md "진행 상태 읽기"의 `agent`, "MCP 게이트웨이"의 `submit_result`.
-- 적용: Supabase 대시보드의 SQL Editor에 붙여 넣어 실행하거나 `supabase db push`.

alter table public.deploy_runs
  add column agent_result jsonb check (agent_result is null or jsonb_typeof(agent_result) = 'object');
