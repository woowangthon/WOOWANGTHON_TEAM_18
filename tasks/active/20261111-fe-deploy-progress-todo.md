# FE deploy start, progress and result address screen (#99)

- **SRS**: UC-08, FR-059 to FR-062, demo steps 6 to 8
- **Owner**: TaeTaeJin (FE session)
- **Branch**: feat/fe-deploy-progress

## Plan

Issue #99 is built against the BE contract in `docs/design/api.md` "배포 시작 · 진행 상태" (BE commit 03685bb on `feat/deploy-start-44`, not merged into `main` yet; the endpoints are not implemented yet either).

- `DeployStages` only draws. It takes one state per stage (`pending` / `queued` / `active` / `done` / `skipped` / `fixing` / `action` / `failed`) and writes a word on each, so colour is never the only signal.
- `progress.ts` holds the contract types and `stageStatesOf`, which maps the server's `steps` and `status` onto those states. The server keeps the working step `active` and says "fixing" / "needs user" in `status`, so the overlay is laid on that step here. A step key or value the server did not name stays "pending" (a stage is never dropped from the list).
- `DeployProgress` reads `GET /api/deploys/:id/status`, again every 3 s only while `running` or `fixing` (a chained timeout, never two requests at once), and stops on any other status, on 404 and when the screen is left. A failed read keeps the last state, shows "not your fault" and keeps trying.
- Start: `POST /api/deploys/:id/start`. The contract says no body, but `apiFetch` sends a POST only with a body, so it sends `{}`. After any outcome the status is read again, because a failed start can still have started (a stored-or-not unknown).
- `/deploys` lists my deploys (`GET /api/deploys`, newest first, server order kept) so a reload finds the running one; `/deploys/:id` is the progress screen. A menu link and a link from the saved-settings screen lead there.

Decisions without a ruling in the issue or the contract:
- Before the start, the `secrets` step the server marks `active` is shown as "사용자 조치 필요" (it is the user's turn), not "진행 중".
- `ALREADY_STARTED` is not shown as an error; the re-read shows the truth.
- A public address is linked only when it starts with `https://`.
- Routes `/deploys` and `/deploys/:id`, menu text `내 배포`.

Answered by the BE (woowangthon-team-18-6c, 2026-11-11), to be written into api.md in its next commit: `NOT_READY` carries `error.fields` as `{ path: "secrets.<service>.<KEY>", code: "REQUIRED" }` (the screen shows `<service> · <KEY>`) (there is no `missing`; that part comes from #82's readiness check, and until it lands start answers `503 NOT_IMPLEMENTED`); a warning is `{ code, message, service | null }` with a message that is safe to show; `{}` with JSON content type is accepted as the start body. The server does not produce `needs_user` or "배포 대기" yet; the screen already draws them.

Known limits, left on purpose: the status read and the list read each hand-write the same load / retry state (two callers; a shared hook is not worth it yet); a retryable error is retried every 3 s with no back-off and no pause while the tab is hidden; each poll replaces the state even when `updatedAt` is unchanged (8 rows).

## Todo

- [x] Stage display — files: `deploy/DeployStages.tsx`, `deploy/stages.ts`
- [x] Map the progress response onto stage states, including an unknown step — files: `deploy/progress.ts`
- [x] Start button: the reasons the server gives (`NOT_READY`, `DEPLOY_IN_PROGRESS`, 503) — files: `deploy/DeployProgress.tsx`
- [x] Progress read and polling: only while running or fixing, 3 s, stops on leave, loading note — files: `deploy/DeployProgress.tsx`
- [x] Done: public address as a link with a copy button
- [x] Failure: the server's message with stage and service; "not the student's fault" for platform codes
- [x] Find an in-progress deploy again after a reload — files: `pages/DeploysPage.tsx`, `pages/DeployProgressPage.tsx`, `App.tsx`, `layout/AppLayout.tsx`, `deploy/DeploySaved.tsx`
- [x] Security scan warnings (UC-10) shown without blocking; the missing items of `NOT_READY` listed by name
- [ ] Once `NOT_IMPLEMENTED` is gone: check that start with a real `{}` works end to end
- [ ] Mutation testing (#67 not introduced; hand mutants on the polling, start and mapping logic were run)
- [ ] Browser check against the real BE (the endpoints do not exist yet) and screenshots (light and dark, 1440px and 390px) — attached by the user

## Done when

A student can start a deploy, watch the stages change, and get the public address or the failure reason, and can come back to it after a reload. The code is there; what is missing is a run against the real endpoints.
