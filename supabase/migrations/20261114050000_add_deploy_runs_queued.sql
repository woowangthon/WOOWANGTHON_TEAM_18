-- 배포 대기열: 시작한 배포는 먼저 'queued'로 저장되고, 서버가 한 번에 하나씩 파이프라인을 부른다.
-- 같은 프로젝트의 진행 중(대기 포함) 실행은 하나만 허용한다.
-- 계약: docs/design/api.md "배포 시작", 설계: docs/design/deploy-workflow.md "배포 대기열".
-- 적용: Supabase 대시보드의 SQL Editor에 붙여 넣어 실행하거나 `supabase db push`. **BE를 새로 배포하기 전에** 적용한다(새 BE가 'queued'를 넣는다).

alter table public.deploy_runs drop constraint deploy_runs_status_check;
alter table public.deploy_runs
  add constraint deploy_runs_status_check check (status in ('queued', 'running', 'fixing', 'needs_user', 'succeeded', 'failed'));

drop index public.deploy_runs_active_slug_idx;
create unique index deploy_runs_active_slug_idx on public.deploy_runs (slug) where status in ('queued', 'running', 'fixing');
