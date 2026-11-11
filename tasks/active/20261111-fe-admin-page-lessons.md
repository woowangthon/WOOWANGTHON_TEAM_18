# FE Admin Page (#101) — lessons

## Log

- 2026-11-11: Started from `upstream/main` 41a72aa. New worktree `WOOWANGTHON_TEAM_18_fe101`. The #100 contract is not in `api.md`, so only the guard and a skeleton are built.
- 2026-11-11: Adding `isAdmin(session)` to `AppLayout` broke 9 tests in `App.test.tsx`: its fake session had no `app_metadata`, which every real Supabase user has. Fixed the fake session, not the code.
- 2026-11-11: `pnpm verify` passed. Hand mutants on `isAdmin`, the guard, its signed-in check and the menu link: 5 of 5 killed.
- 2026-11-11: `/code-review low`: one low-confidence note (`RequireAdmin` returns null when not signed in) — not real, `RequireAuth` only renders its `Outlet` for a signed-in user. That reviewer said it read the diff only, so this is a thin review. `/simplify` (4 angles): applied the tests folded into `App.test.tsx` (the Supabase mock was copied, `isAdmin` unit test duplicated the render tests) and `isAdmin` as one expression; documented in `auth.md` that the FE mirrors the rule for display only. Left: inlining `ForbiddenNotice` (the server 403 case will use it), moving `isAdmin` onto `useAuth()` (two consumers so far); both recorded in the todo.
- 2026-11-11: Not checked: a browser, a real BE, a real admin account, screenshots.

## Lessons

<fill when done>
