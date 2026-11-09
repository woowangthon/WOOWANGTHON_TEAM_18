# FE session, API client, GitHub link and repo check (#54, #53, #56, #57, #58)

- **SRS**: demo path (issues #54, #53, #56, #57, #58; ADR-007: Supabase Auth from the FE, BE verifies the JWT)
- **Owner**: TaeTaeJin
- **Branch**: feat/fe-session-deploy

## Plan

Five demo-path issues are done on one branch, one commit per issue, so the work is not repeated per PR (review wait, rebase, CI). Later the branch is cut into two PRs by dependency order: **PR-A = #54 + #53**, **PR-B = #56 + #57 + #58**. Nothing is pushed until then.

- **#54 API client** — `apiFetch(path, body?)` adds `Authorization: Bearer` from the current Supabase session, throws `ApiError { status, code }` from the BE error body `{ error: { code, message } }`. A 401 signs the user out; 503 and network errors do not (F-1: an outage is not "logged out" or "none"). Relative `/api/...` paths only: the production base URL is open question 9 in `docs/system-definition.md`, and the dev proxy covers local work.
- **#53 Session and guard** — one auth context over `onAuthStateChange`, a route guard for `/dashboard`, `/profile`, `/deploy/new`, an app bar with a logout button, return to the original page after login, and the session-expired screen (X1) when a session ends without the user pressing logout.
- **#56 GitHub link** — profile page: link state from `getUserIdentities()`, `linkIdentity({ provider: 'github' })`, screens G1-G4. The Profile wireframe file is not available, so the layout is composed from G1-G4 and the dashboard hints.
- **#57 Repo check** — `/deploy/new`: repo URL field, `POST /api/repos/check`, one message per error code (F1 copy).
- **#58 Dockerfile check** — the result of `POST /api/repos/dockerfiles`: list, empty (fact only), `truncated` (never claim "none"), 503 retry. What to do when there is no Dockerfile is undecided (#25) and not built.
- **Not here**: signup (#52) and reset (#55) wait for the Supabase dashboard work (#49); notifications; dashboard content; project-type / database radios from wireframe S1; unlinking GitHub.

## Todo

- [ ] #54 `apiFetch` + `ApiError` + tests — files: `FE/src/lib/api.ts`, `FE/src/lib/api.test.ts`
- [ ] #53 auth context, guard, app bar, X1, login return + tests, `docs/ai-scope.md` — files: `FE/src/auth/*`, `FE/src/layout/AppLayout.tsx`, `FE/src/App.tsx`, `FE/src/pages/LoginPage.tsx`
- [ ] #56 profile page + tests, `docs/design/auth.md`, `docs/ai-scope.md` — files: `FE/src/pages/ProfilePage.tsx`
- [ ] #57 repo check page + tests — files: `FE/src/pages/DeployNewPage.tsx`
- [ ] #58 Dockerfile check + tests — files: `FE/src/pages/DockerfileCheck.tsx`
- [ ] Check every screen in Chromium with faked responses (light/dark, 1440/390)
- [ ] Independent review with agy per PR range, each finding verified before acting

## Done when

- [ ] `cd FE && pnpm verify` passes on every commit
- [ ] Each state is seen in a browser; no console errors, no horizontal scroll
- [ ] Real Supabase login return, X1 and the GitHub link are confirmed by the user (needs #49)
- [ ] tests added; mutation testing not run — no mutation tool chosen yet (conventions §6), noted in the PR bodies
