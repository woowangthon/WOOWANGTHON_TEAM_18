-- 확정한 배포 입력(commit + spec). 행 하나가 배포 입력 하나이고 id가 deployId다. 저장한 뒤에는 바꾸지 않는다(고치면 새 행).
-- 계약: docs/design/api.md "배포 입력 저장", 설계: docs/design/auth.md "배포 입력 저장".
-- 적용: Supabase 대시보드의 SQL Editor에 붙여 넣어 실행하거나 `supabase db push`.

create table public.deploys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- spec.project.slug. 클러스터 네임스페이스 proj-<slug>와 공개 주소가 이 값으로 정해진다.
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,56}[a-z0-9])?$'),
  -- GitHub가 돌려준 owner/name 표기
  repo text not null check (repo ~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  spec jsonb not null check (jsonb_typeof(spec) = 'object'),
  created_at timestamptz not null default now()
);

create index deploys_user_id_created_at_idx on public.deploys (user_id, created_at desc);
create index deploys_slug_idx on public.deploys (slug);

-- 쓰기는 서버의 secret key(service role, RLS를 건너뛴다)만 한다. 그래서 쓰기 정책을 만들지 않는다.
-- 사용자는 Supabase로 직접 읽어도 자기 행만 보인다(서버는 읽을 때 user_id 조건을 따로 붙인다).
alter table public.deploys enable row level security;

create policy "deploys: owner can read"
  on public.deploys
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- RLS를 건너뛰는 서버 키 말고는 쓸 수 없게 권한도 거둔다(정책이 없어도 막히지만 한 겹 더).
revoke insert, update, delete, truncate on public.deploys from anon, authenticated;
