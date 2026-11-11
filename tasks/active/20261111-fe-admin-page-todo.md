# FE Admin Page (#101)

- **SRS**: UC-17, FR-083, FR-084, FR-094 (as the issue cites them)
- **Owner**: TaeTaeJin (FE session)
- **Branch**: feat/fe-admin-page

## Plan

Built against the BE operator API contract in `docs/design/api.md` "운영자 API" (BE branch `feat/admin-cluster-100`, commit 5f8b3a3, code not written yet at the time of this commit).

- `isAdmin(session)` reads `app_metadata.role === 'admin'` (never `user_metadata`). Hiding the screen is a convenience; the server decides, and its `403 ADMIN_REQUIRED` on either read shows the same `ForbiddenNotice` and stops the refresh.
- `RequireAdmin` is a layout route inside `RequireAuth`; route `/admin`; the menu link `관리자` is for admins only.
- `useAdminRead(path)` reads a path and re-reads every `REFRESH_MS` (10 s, not given by the contract: a decision, longer than the student screen's 3 s so the cluster is not hit often). A failed read keeps the last data and says it is the last value read.
- Nodes (`GET /api/admin/nodes`) and projects (`GET /api/admin/projects`) are cards, not tables, so 390px needs no horizontal scroll. Usage shows "수집 전" unless the server says `usageStatus: "collected"`; nothing is computed, only formatted (GiB, cores). `null` fields read "읽지 못함".
- A project is "running" while any service has replicas > 0, "stopped" when all are 0, "공간 없음" when `services` is empty (the contract says to look at `replicas`, not `lastStop`). Only a running project offers the stop button.
- Force stop: button, then a confirm box naming the project, then `POST /api/admin/projects/:slug/stop` (sent with `{}` because `apiFetch` only POSTs with a body), then the projects are read again whatever the result. Partial success (`failed` not empty), `NOT_RUNNING`, `PROJECT_NOT_FOUND`, `CLUSTER_FORBIDDEN` (the scale permission is not granted yet, so this is the expected answer for now) and `CLUSTER_UNREACHABLE` each have their own words.
- `CLUSTER_UNREACHABLE` reads "리더 무응답"; `CLUSTER_FORBIDDEN` reads "리더에는 닿았지만 서버 계정에 권한이 없어요".

## Todo

- [x] Route guard, forbidden screen, menu link — `admin/RequireAdmin.tsx`, `admin/ForbiddenNotice.tsx`, `auth/isAdmin.ts`, `App.tsx`, `layout/AppLayout.tsx`
- [x] Node cards, project cards with services and pods, refresh, "리더 무응답", server 403 — `admin/*`, `pages/AdminPage.tsx`
- [x] Force stop with a confirm step and the result — `admin/ProjectCard.tsx`
- [x] Tests: `pages/AdminPage.test.tsx` (29), guard tests in `App.test.tsx`
- [x] Hand mutants on the decision logic (state of a project, https link, usage collected, 403 handling, refresh, stop flow, formatting)
- [ ] Mutation testing (#67 not introduced)
- [ ] A real round trip with the BE (needs `feat/admin-cluster-100` merged, an admin account and the cluster permissions)
- [ ] 390px layout looked at in a browser (built as cards with no fixed widths, never viewed)
- [ ] Screenshots (light and dark, 1440px and 390px) — attached by the user
- [ ] Whether `isAdmin` should move onto `useAuth()` when a third consumer appears

## Done when

An admin sees node status and running services from the real API, can force-stop a service after confirming, and a non-admin cannot reach or use the page.
