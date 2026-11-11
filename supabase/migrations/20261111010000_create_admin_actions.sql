-- 운영자 조치 기록(강제 중지). 누가 언제 어느 프로젝트를 껐는지 남긴다. 조치를 하기 전에 한 줄을 먼저 적는다.
-- 계약: docs/design/api.md "운영자 API", 이슈 #100. 적용: Supabase 대시보드의 SQL Editor에 붙여 넣어 실행하거나 `supabase db push`.

create table public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,56}[a-z0-9])?$'),
  action text not null check (action in ('stop')),
  actor_id uuid not null,
  actor_email text not null,
  created_at timestamptz not null default now()
);

create index admin_actions_slug_idx on public.admin_actions (slug, created_at desc);

-- 서버의 secret key(service role)만 읽고 쓴다. 정책이 없으므로 사용자 토큰과 공개 키로는 아무 행도 보이지 않는다.
alter table public.admin_actions enable row level security;
revoke all on public.admin_actions from anon, authenticated;
