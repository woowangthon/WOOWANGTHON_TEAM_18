-- 보안 검사(UC-10, #45) 기록. 레포 · commit마다 한 줄이다(같은 commit은 한 번만 검사한다).
-- findings는 위치만 담는다: 비밀값은 { kind: 'secret', file, line, rule }, 커밋된 .env는 { kind: 'env_file', file },
-- 취약점은 { kind: 'vuln', target, pkg, version, id, severity, fixed }. 비밀값 자체는 저장하지 않는다.
-- error는 검사가 끝나지 못한 이유의 내부 코드(SOURCE_TOO_LARGE 등)이고 학생에게는 SCAN_FAILED로 보인다.
-- 계약: docs/design/api.md "진행 상태 읽기"의 `warnings`.
-- 적용: Supabase 대시보드의 SQL Editor에 붙여 넣어 실행하거나 `supabase db push`.

create table public.security_scans (
  -- deploys.repo와 같은 표기(GitHub가 돌려준 owner/name)
  repo text not null check (repo ~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  status text not null check (status in ('running', 'done', 'failed')),
  findings jsonb not null default '[]'::jsonb check (jsonb_typeof(findings) = 'array'),
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (repo, commit_sha)
);

-- 읽기 · 쓰기 모두 서버의 secret key(service role, RLS를 건너뛴다)만 한다. 학생은 진행 상태 API로만 본다.
alter table public.security_scans enable row level security;
revoke all on public.security_scans from anon, authenticated;
