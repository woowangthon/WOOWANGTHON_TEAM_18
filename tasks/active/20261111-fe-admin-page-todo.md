# FE Admin Page (#101)

- **SRS**: UC-17, FR-083, FR-084, FR-094 (as the issue cites them)
- **Owner**: TaeTaeJin (FE session)
- **Branch**: feat/fe-admin-page

## Plan

Issue #101 waits for the BE operator API contract (#100) in `docs/design/api.md`. That contract has not landed, so this branch holds only what does not depend on it: the route guard, the "no permission" screen and a page skeleton. No node or service numbers are shown, so nothing here can be a made-up value.

- `isAdmin(session)` reads `app_metadata.role === 'admin'` from the Supabase session, as `docs/design/auth.md` defines `isAdmin`. `user_metadata` is never read (the user can edit it). Hiding the screen is a convenience; the server decides and its 403 must show the same "no permission" screen (to do with the API).
- `RequireAdmin` is a layout route inside `RequireAuth`. A signed-in non-admin sees `ForbiddenNotice` (not a redirect, so the address stays and the reason is stated). The menu link `관리자` is shown to admins only.
- Route `/admin`. The path is a decision, not in the issue.

## Todo

- [x] Route guard, forbidden screen, menu link, page skeleton — files: `admin/RequireAdmin.tsx`, `admin/ForbiddenNotice.tsx`, `auth/isAdmin.ts`, `pages/AdminPage.tsx`, `App.tsx`, `layout/AppLayout.tsx`
- [x] Tests: admin opens, non-admin blocked with no page content, link hidden, signed-out goes to login, `user_metadata` ignored
- [ ] Node status table (Ready, role, CPU / memory / disk capacity · allocated · used; show "수집 전" exactly when the server says so) — blocked on the contract
- [ ] Running services list (project, owner, state, node, restarts, public URL) — blocked on the contract
- [ ] Force stop with a confirm dialog that repeats the project name — blocked on the contract
- [ ] Refresh at the interval the BE doc gives; `503` shows "리더 무응답" prominently; server `403` shows `ForbiddenNotice` — blocked on the contract
- [ ] At 390px the tables become cards with no horizontal scroll
- [ ] Mutation testing (#67 not introduced; hand mutants on the guard were run)
- [ ] Screenshots (light and dark, 1440px and 390px) — attached by the user

## Done when

An admin sees node status and running services from the real API, can force-stop a service after confirming, and a non-admin cannot reach or use the page. This branch alone does not reach that.
