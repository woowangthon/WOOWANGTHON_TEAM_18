# FE app foundation: router, Supabase client, env, dev proxy — lessons

## Log

- 2026-11-09: Issues #49-#58 written and opened. This one is #50; Supabase dashboard work (#49) is done by hand in parallel.
- 2026-11-09: Worked in a separate `git worktree` (`~/work/WOOWANGTHON_TEAM_18_fe`, branched from `upstream/main`) so the BE branch in the main checkout stayed untouched. Install took 2 seconds there; the main checkout lives on `/mnt/c`.
- 2026-11-09: `react-router` resolved to 8.5.1. It exports `BrowserRouter`, `Routes` and `Route` itself (no separate `react-router-dom`) and requires Node >=22.22.0, while `FE/package.json` `engines` still allows ^22.13.0. Left as is; noted in the PR.
- 2026-11-09: Dropped the planned edit to `docs/design/design-system.md` ("하지 않는 것: 라우터"). That line is the design system's own scope and is still true, so changing it would have made it wrong.
- 2026-11-09: Browser check used Playwright installed in a scratch folder (not a FE dependency). The cached Chromium revision (1228) differs from the one the latest Playwright wants (1254); launching with `executablePath` pointing at the cached binary worked.
- 2026-11-09: An independent review by agy (GPT-OSS 120B, used because the Gemini quota ran out) raised five findings and all were wrong: it claimed `react-router-dom` was missing (v8 exports everything from `react-router`) and that the proxy needed a `rewrite` (the BE has the global prefix `api`, so a rewrite would break it). Each finding was checked against the code and the running app.
- 2026-11-09: `/code-review` and `/simplify` were not run: they work on the session's primary directory, which is the BE checkout, and could touch the BE branch. The diff was read by hand instead.

- 2026-11-09: Checked with the real Supabase project (the same values as `BE/.env`, renamed with the `VITE_` prefix): the dev server injects them, the client is created, and a fake login gets `400 invalid_credentials` from Supabase, so the URL and key are valid. Copying `BE/.env` unchanged does not work: Vite exposes only `VITE_*` variables, and it read 0 of them from a file with the BE names. The Supabase auth settings endpoint showed email sign-in and the GitHub provider on, and Confirm email on.

## Lessons

- A small open model as the second reviewer invents defects from outdated library knowledge. Check each finding against the installed package or the running app before acting; "no defects found" from such a model does not replace reading the diff yourself.
- Slash-command reviews follow the session's primary directory, not a worktree. When working in a worktree next to someone else's branch, run them from a session started in the worktree.
