# FE app foundation: router, Supabase client, env, dev proxy

- **SRS**: no FR; foundation work for login, GitHub link and the deploy page (issue #50; screens follow in #51-#58)
- **Owner**: TaeTaeJin
- **Branch**: feat/fe-app-foundation

## Plan

The FE draws nothing yet (`App` returns `null`), so every screen issue is blocked on the same four things: a router, a Supabase client, a place for the two `VITE_*` settings, and a way to reach the BE from the dev server. This task adds only those, so #51-#58 can each fill in their own page.

- **Router**: `react-router`, `BrowserRouter` in `main.tsx`, five empty routes (`/login`, `/signup`, `/reset-password`, `/profile`, `/deploy/new`), one file per page under `src/pages/` so parallel screen PRs never edit the same file. No `/` redirect, no 404 page ([`docs/conventions.md`](../../docs/conventions.md) F-2).
- **Supabase client**: `src/lib/supabase.ts` throws, naming the variable, when `VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY` is empty (F-1: no silent fallback). Nothing imports it yet, so tests and `pnpm dev` run without a `.env`; the first user is the session context in #53.
- **Dev proxy**: `/api` goes to `http://localhost:3000`, the BE default (`BE/.env.example`). A changed BE `PORT` means editing that line; the comment says so.
- **No new test libraries**: `@testing-library/jest-dom` and `user-event` are not installed, so tests use `getByRole` and `textContent`.
- **Not done here**: the `docs/SRS.md` §2.6 row for FE env vars (SRS follows Notion, [CONTRIBUTING.md](../../CONTRIBUTING.md) §3; the names live in `FE/.env.example`) and a CloudFront fallback that sends unknown paths to `index.html` (no CloudFront config exists yet). Both go in the PR body as known limits.

## Todo

- [ ] Router and five empty pages, replace the "renders nothing" smoke test with one test per route — files: `FE/src/main.tsx`, `FE/src/App.tsx`, `FE/src/pages/*.tsx`, `FE/src/App.test.tsx`, `FE/package.json`
- [ ] Docs for the router — files: `docs/ai-scope.md` §1, `docs/design/design-system.md`
- [ ] Supabase client that fails loudly on missing settings, with tests for both cases — files: `FE/src/lib/supabase.ts`, `FE/src/lib/supabase.test.ts`, `FE/src/vite-env.d.ts`, `FE/.env.example`
- [ ] Docs for supabase-js — files: `docs/ai-scope.md` §1
- [ ] Dev server proxy for `/api` — files: `FE/vite.config.ts`
- [ ] Add the two design skills to the optional plugin table — files: `.claude/skills/README.md`

## Done when

- [ ] `cd FE && pnpm install --frozen-lockfile && pnpm verify` passes
- [ ] Each of the five routes opens in `pnpm dev` (checked in Chromium, light and dark, 390px and 1440px) with no console errors
- [ ] `curl -i localhost:5173/api/health` reaches the proxy (a proxy error while the BE is down, not the SPA's `index.html`)
- [ ] tests added; mutation testing not run — no mutation tool chosen yet (conventions §6), noted in the PR body
