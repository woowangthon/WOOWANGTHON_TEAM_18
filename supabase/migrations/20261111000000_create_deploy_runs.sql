-- 배포 실행 기록: 저장한 배포 입력(deploys) 하나를 시작하면 한 줄이 생기고, 파이프라인 알림이 올 때마다 바뀐다.
-- 계약: docs/design/api.md "배포 시작 · 진행 상태", 설계: docs/design/deploy-workflow.md §1 · §6.
-- 적용: Supabase 대시보드의 SQL Editor에 붙여 넣어 실행하거나 `supabase db push`.

create table public.deploy_runs (
  deploy_id uuid primary key references public.deploys (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,56}[a-z0-9])?$'),
  target_slot text not null check (target_slot in ('a', 'b')),
  -- 시작할 때 만든 배포 입력(commitSha · deploy_condition · spec). 비밀값은 없다(key 이름만).
  input jsonb not null check (jsonb_typeof(input) = 'object'),
  status text not null check (status in ('running', 'fixing', 'needs_user', 'succeeded', 'failed')),
  -- 지금 도는(실패했다면 실패한) 파이프라인 스테이지. 끝난 뒤(succeeded)는 null.
  stage text check (stage in ('build', 'prepare', 'render', 'apply', 'verify', 'switch')),
  -- { code, stage, service }. 학생에게 보이는 문장은 코드에서 만든다. 원본 · 로그는 저장하지 않는다.
  failure jsonb,
  -- AI 서버에 보낸 문제 티켓. 게이트웨이 토큰은 해시만 둔다.
  ticket_id text,
  gateway_token_hash text,
  gateway_expires_at timestamptz,
  -- 빌드 스테이지가 알린 서비스별 이미지 digest. 전환 때 build_cache에 옮긴다.
  images jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index deploy_runs_user_id_idx on public.deploy_runs (user_id);

-- 같은 프로젝트의 배포는 한 번에 하나만 돈다. 읽고 나서 쓰는 검사와 달리 동시에 시작해도 하나만 통과한다.
create unique index deploy_runs_active_slug_idx on public.deploy_runs (slug) where status in ('running', 'fixing');

-- 서버의 secret key(service role)만 읽고 쓴다. 정책이 없으므로 사용자 토큰과 공개 키로는 아무 행도 보이지 않는다.
alter table public.deploy_runs enable row level security;
revoke all on public.deploy_runs from anon, authenticated;
