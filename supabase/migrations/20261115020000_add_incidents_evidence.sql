-- 운영 알림의 근거(docs/design/incidents.md "근거"): 알림을 연 때, 멈추기 전에 모은 Pod 상태와 로그 마지막 20줄.
-- { pod, restarts, waiting, lastExit: { reason, exitCode } | null, logs: string[] }. 로그는 비밀값 필터를 거친 값이다.
-- 적용: Supabase 대시보드의 SQL Editor에 붙여 넣어 실행하거나 `supabase db push`. BE 배포보다 먼저.
alter table public.incidents add column evidence jsonb;
