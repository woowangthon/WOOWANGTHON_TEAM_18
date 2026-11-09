# BE GitHub link + repo-ownership check

- **SRS**: NFR-SEC-04 (no FR — foundation work; the decision is [ADR-007](../../docs/adr/007-login-email-password-github-link.md))
- **Owner**: TaeTaeJin
- **Branch**: feat/be-github-link (issue #27; this PR closes it)

## Plan

A student logs in with email + password and links GitHub once on the profile; a deploy request must be for a public personal repo owned by that GitHub account. This PR builds the BE side: `POST /api/repos/check` takes a repo URL and answers whether the logged-in user's linked GitHub account owns it. The FE calls it before submit; the later submit API reuses the same service. The link itself (`linkIdentity`) is done by the FE with supabase-js, so no BE endpoint exists for it.

The linked GitHub ID is read with the **user's own access token** (`GET <SUPABASE_URL>/auth/v1/user` → `identities`), not with the service role key that ADR-007 assumed. Checked on the dev test account first: the response has `identities`, the `apikey` header is required, a forged token gets `403 bad_jwt`. So the BE holds no Supabase secret — only the public key (`SUPABASE_PUBLISHABLE_KEY`) — and a signed-out session is refused. ADR-007's consequence sentence was corrected for this.

The repo is read from GitHub's public API without credentials (the user's token never goes to GitHub). Outside failures are `503`, never a user error ([`docs/conventions.md`](../../docs/conventions.md) F-1). No submit API or DB exists yet, so nothing is stored; the check runs on every call because a student can unlink.

## Todo

- [x] Docs first: `auth.md` design and error order, `api.md` contract, SRS §2.4 row + NFR-SEC-04, ADR-007 consequence fix, ai-scope — files: `docs/`
- [x] `SUPABASE_PUBLISHABLE_KEY` setting (required, no whitespace) — files: `BE/src/config/env.ts`, `BE/.env.example`, `BE/vitest.config.ts`
- [x] Repo URL parsing — files: `BE/src/repos/repo-url.ts`
- [x] Ownership service, controller, module; guard keeps the raw token in `req.accessToken` (not in `AuthUser`) — files: `BE/src/repos/`, `BE/src/auth/`
- [x] Tests: URL unit tests, ownership e2e (every error branch, ID-not-login, token never sent to GitHub, 5 s timeouts), shared test helpers — files: `BE/test/`

## Done when

(CI green is left for the PR checks to show; tick it at merge time.)

- [x] History is docs first, then code (docs, env, URL parser, API, task docs), plus review follow-ups appended as separate commits (ai-scope row, 401 fix, task docs) instead of rewriting pushed history; each code commit passes `pnpm install --frozen-lockfile && pnpm verify` on its own
- [x] Real Supabase, test account **not linked**: no token → `401 AUTH_REQUIRED`; garbage token → `401 INVALID_TOKEN`; bad URL → `400`; valid URL → `403 GITHUB_NOT_LINKED`; malformed JSON → `400 BAD_REQUEST`; `GET /api/me` unchanged; boot stops without the key
- [x] Real Supabase + real GitHub, test account **linked** (throwaway local page, not committed), 2026-11-09: own repo (`TaeTaeJin/WOOWANGTHON_TEAM_18`, also with `.git`) → `200`; organization repo (`woowangthon/WOOWANGTHON_TEAM_18`) → `422 REPO_NOT_PERSONAL`; someone else's personal repo (`torvalds/linux`) → `403 REPO_NOT_OWNED`; missing repo → `404 REPO_NOT_FOUND`; non-GitHub URL → `400`; `GET /api/me` keys unchanged (`email`, `id`, `isAdmin`). The linked identity's `id` is a string, as assumed
- [ ] CI green on GitHub
- [x] Notion SRS synced (NFR-SEC-04, §2.4) — confirmed by TaeTaeJin in the PR #36 review thread, 2026-11-09
- [x] Tests added; mutation testing not run with a tool — none chosen yet (conventions §6); hand-made mutants, see lessons
