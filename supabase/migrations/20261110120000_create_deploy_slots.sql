-- 슬롯 A · B 배포의 상태: 프로젝트의 live 슬롯, 슬롯별 배포 입력 · manifest, 빌드 캐시.
-- 설계: docs/design/deploy-workflow.md §4 "슬롯 A · B", docs/design/deploy-handoff.md "deploy_condition.services".
-- 적용: Supabase 대시보드의 SQL Editor에 붙여 넣어 실행하거나 `supabase db push`.
-- 슬롯 이름은 클러스터의 리소스 이름(`<서비스>-a`) · Pod 라벨 `slot`과 같은 소문자 'a' · 'b'다.

-- 프로젝트마다 한 줄. live_slot은 open Ingress가 가리키는 슬롯이고, 첫 전환(W7) 전에는 null이다. 대상 슬롯은 그 반대쪽(null이면 a)이다.
create table public.projects (
  slug text primary key check (slug ~ '^[a-z0-9]([a-z0-9-]{0,56}[a-z0-9])?$'),
  live_slot text check (live_slot in ('a', 'b')),
  updated_at timestamptz not null default now()
);

-- 프로젝트 + 슬롯마다 한 줄(프로젝트당 2줄까지). 그 슬롯에 배포하기 직전에 줄을 새 배포 입력으로 통째로 바꾼다.
-- input은 deploy_condition을 채운 배포 입력(commitSha · deploy_condition · spec), manifest는 Render가 만든 YAML(Render 전에는 null).
create table public.deploy_state (
  slug text not null references public.projects (slug) on delete cascade,
  slot text not null check (slot in ('a', 'b')),
  deploy_id uuid not null references public.deploys (id) on delete cascade,
  input jsonb not null check (jsonb_typeof(input) = 'object'),
  manifest text,
  updated_at timestamptz not null default now(),
  primary key (slug, slot)
);

-- 서비스 × 빌드 입력 해시 → 이미지 digest. 같은 해시면 빌드하지 않고 이 이미지를 쓴다(reuse). 슬롯을 비워도 지우지 않는다.
create table public.build_cache (
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,56}[a-z0-9])?$'),
  service text not null check (service ~ '^[a-z]([a-z0-9-]{0,50}[a-z0-9])?$'),
  build_input_hash text not null check (build_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  -- 모든 프로젝트가 쓰는 공개 패키지 하나의 digest 주소(태그가 아니라 @sha256:)
  image text not null check (image ~ '^ghcr\.io/[a-z0-9][a-z0-9-]{0,38}/student-apps@sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (slug, service, build_input_hash)
);

-- 세 테이블 모두 서버의 secret key(service role, RLS를 건너뛴다)만 읽고 쓴다. 정책을 만들지 않으므로 사용자 토큰과 공개 키로는 아무 행도 보이지 않는다.
alter table public.projects enable row level security;
alter table public.deploy_state enable row level security;
alter table public.build_cache enable row level security;

revoke all on public.projects, public.deploy_state, public.build_cache from anon, authenticated;
