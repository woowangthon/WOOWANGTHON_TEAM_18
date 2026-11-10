# BE login token verification

- **SRS**: NFR-SEC-03 (no FR — login is foundation work; the decision is [ADR-007](../../docs/adr/007-login-email-password-github-link.md))
- **Owner**: TaeTaeJin
- **Branch**: feat/be-auth (PR #28, part of issue #27)

## Plan

Login moves from GitHub OAuth (ADR-001) to Supabase Auth email + password, so the judges' test account is not one of our GitHub accounts (credential handover, 2FA). Repo ownership is still checked, through a GitHub account linked once on the profile — that is the next PR. The admin account needs no GitHub link and sees everything.

This PR records the decision (ADR-007, partial supersede of ADR-001 auth and ADR-002 student login) and builds the BE side: the FE signs in with supabase-js, the BE only verifies the access token. No login or signup endpoint in the BE. A global guard verifies the token against the project's public key set (jose) and puts `{ id, email, isAdmin }` on the request; `@Public()` opts a route out. Key-set failures are `503 AUTH_UNAVAILABLE`, never `401`, so the FE does not log people out during a Supabase outage. Admin comes from `app_metadata.role` only. All errors use the SRS common shape via one exception filter.

## Todo

- [x] ADR-007; ADR-001 / ADR-002 status lines; system definition §3 · §4.1 · §4.3 · §6, ai-scope, two diagrams — files: `docs/adr/`, `docs/system-definition.md`, `docs/ai-scope.md`, `docs/architecture/`
- [x] Auth design and API contract (`GET /api/me`), SRS §2.4 group and NFR-SEC-03 — files: `docs/design/auth.md`, `docs/design/api.md`, `docs/SRS.md`
- [x] Error filter (`{ error: { code, message } }`, hidden 500) — files: `BE/src/common/`, `BE/src/app.setup.ts`
- [x] `SUPABASE_URL` env, global guard, `@Public()`, `@CurrentUser()`, `GET /api/me`, e2e tests — files: `BE/src/auth/`, `BE/src/config/`, `BE/test/`, `BE/vitest.config.ts`
- [x] ai-scope (jose row, BE row), conventions §6 (test doubles vs `MOCK`)

## Done when

- [x] History is 5 commits (ADR, design, error filter, auth, task docs); each code commit passes `pnpm install --frozen-lockfile && pnpm verify` on its own
- [x] Running against the real project: `/api/me` without a token → `401 AUTH_REQUIRED`; a token signed by another key with the real `kid` → `401 INVALID_TOKEN` (the real key set was fetched); unreachable auth server → `503`; missing `SUPABASE_URL` stops boot. Same in the container
- [x] A real login token from a test account → `200` from `/api/me`; the same token with a signature byte flipped, or with `app_metadata.role` changed to admin, → `401 INVALID_TOKEN`
- [x] CI green on GitHub (#28)
- [ ] Notion SRS synced (NFR-SEC-03, §2.4) — TaeTaeJin keeps Notion in step with the repo docs
- [x] Tests added (filter unit tests, env unit tests, auth e2e for every 401 / 503 path and admin); mutation testing not run with a tool — none chosen yet (conventions §6); hand-made mutants on the guard, see lessons
