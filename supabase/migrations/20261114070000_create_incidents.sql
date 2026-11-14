-- 운영 알림(스파이크 감지, docs/design/incidents.md). Prometheus 경고 하나가 학생 프로젝트 하나에서 울리면 한 줄이다.
-- 같은 프로젝트 · 같은 경고는 열린 것(resolved_at is null)이 하나뿐이다. 감시기가 20초마다 읽고, 경고가 사라지면 resolved_at을 채운다.
-- 적용: Supabase 대시보드의 SQL Editor에 붙여 넣어 실행하거나 `supabase db push`. BE 배포보다 먼저.

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,56}[a-z0-9])?$'),
  alertname text not null check (char_length(alertname) between 1 and 200),
  -- 경고의 라벨 중 고른 것(namespace · pod · container 등)과 summary. 비밀값 필터를 거친 값이다.
  labels jsonb not null default '{}'::jsonb,
  summary text not null default '',
  fired_at timestamptz not null,
  resolved_at timestamptz,
  -- auto_stopped: 규칙이 바로 멈춤(재시작 반복) · pending: 사람이 정할 차례 · stopped / dismissed: 운영자가 정함
  action text not null check (action in ('auto_stopped', 'pending', 'stopped', 'dismissed')),
  -- AI 판단 { status, risk, recommendation, cause, reason, model }
  ai jsonb not null,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index incidents_open_uniq on public.incidents (slug, alertname) where resolved_at is null;
create index incidents_created_idx on public.incidents (created_at desc);

-- 학생이 넣은 Discord 웹후크 주소. 주소 자체가 보내기 권한이라 비밀처럼 다룬다(응답에는 끝 4자만).
create table public.user_webhooks (
  user_id uuid primary key,
  url text not null check (url like 'https://discord.com/api/webhooks/%'),
  updated_at timestamptz not null default now()
);

-- 서버의 secret key(service role)만 읽고 쓴다. 정책이 없으므로 사용자 토큰과 공개 키로는 아무 행도 보이지 않는다.
alter table public.incidents enable row level security;
revoke all on public.incidents from anon, authenticated;
alter table public.user_webhooks enable row level security;
revoke all on public.user_webhooks from anon, authenticated;
