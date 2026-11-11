# FE Admin Page (#101) — lessons

## Log

- 2026-11-11: Started from `upstream/main` 41a72aa. New worktree `WOOWANGTHON_TEAM_18_fe101`. The #100 contract is not in `api.md`, so only the guard and a skeleton are built.
- 2026-11-11: Adding `isAdmin(session)` to `AppLayout` broke 9 tests in `App.test.tsx`: its fake session had no `app_metadata`, which every real Supabase user has. Fixed the fake session, not the code.
- 2026-11-11: `pnpm verify` passed. Hand mutants on `isAdmin`, the guard, its signed-in check and the menu link: 5 of 5 killed.
- 2026-11-11: `/code-review low`: one low-confidence note (`RequireAdmin` returns null when not signed in) — not real, `RequireAuth` only renders its `Outlet` for a signed-in user. That reviewer said it read the diff only, so this is a thin review. `/simplify` (4 angles): applied the tests folded into `App.test.tsx` (the Supabase mock was copied, `isAdmin` unit test duplicated the render tests) and `isAdmin` as one expression; documented in `auth.md` that the FE mirrors the rule for display only. Left: inlining `ForbiddenNotice` (the server 403 case will use it), moving `isAdmin` onto `useAuth()` (two consumers so far); both recorded in the todo.
- 2026-11-11: Not checked: a browser, a real BE, a real admin account, screenshots.
- 2026-11-11: The #100 contract arrived (5f8b3a3). Built the admin screen on this PR. Decisions: 10 s refresh, cards not tables, `{}` body for the stop POST, a stopped project is told by `replicas`, a failed read keeps the last data and says so, a server 403 on either read shows `ForbiddenNotice`.
- 2026-11-11: Hand mutants (running vs stopped, no-namespace, https link, stop without confirm, no re-read after stop, double send, partial result, NOT_RUNNING, usage collected, stale note, 403 stop, either-read 403, refresh both, keep data, cluster codes, CPU rounding, GiB, null text): the first run left 5 alive (partly-stopped project, `http` link, usage object while not collected, projects-only 403, CPU rounding); tests were added and all are killed now.
- 2026-11-11: Not checked: a browser (390px never viewed), the real endpoints (the BE code is not written), a real admin account, screenshots, mutation tool (#67).

## Lessons

<fill when done>
