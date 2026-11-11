-- 비밀값의 상태: 프로젝트 × 서비스마다 한 줄. **값은 두지 않는다**: key 이름, 상태, 해시만.
-- 설계: docs/design/api.md "비밀값", docs/design/auth.md "비밀값".
-- 적용: Supabase 대시보드의 SQL Editor에 붙여 넣어 실행하거나 `supabase db push`.
-- 서버는 리더의 Secret을 읽을 수 없어(cluster.md §8) 이 줄이 "들어감"의 근거다. 서비스의 Secret은 통째로 바뀌므로 줄도 서비스마다 하나다.

create table public.deploy_secrets (
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,56}[a-z0-9])?$'),
  service text not null check (service ~ '^[a-z]([a-z0-9-]{0,50}[a-z0-9])?$'),
  -- 마지막으로 쓴 Secret의 key 이름(정렬한 것)
  keys text[] not null,
  -- writing: 쓰기를 시작했고 끝났는지 모른다. in: 리더에 쓰기가 끝났다.
  status text not null check (status in ('writing', 'in')),
  -- 서비스의 key · 값 쌍의 sha256. in일 때만 있다.
  digest text check (digest ~ '^sha256:[0-9a-f]{64}$'),
  updated_at timestamptz not null default now(),
  primary key (slug, service),
  check ((status = 'in') = (digest is not null))
);

-- 서버의 secret key(service role, RLS를 건너뛴다)만 읽고 쓴다. 정책을 만들지 않으므로 사용자 토큰과 공개 키로는 아무 행도 보이지 않는다.
alter table public.deploy_secrets enable row level security;
revoke all on public.deploy_secrets from anon, authenticated;
