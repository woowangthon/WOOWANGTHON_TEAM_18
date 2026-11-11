# FE deploy start, progress and result address screen (#99)

- **SRS**: UC-08, FR-059 to FR-062, demo steps 6 to 8
- **Owner**: TaeTaeJin (FE session)
- **Branch**: feat/fe-deploy-progress

## Plan

Issue #99 waits for the BE progress read contract (#98) and the deploy start API contract (#44) in `docs/design/api.md`. Neither has landed, and SRS says the progress fields are "not decided". So this branch holds only the stage display, which comes from FR-060 and `deploy-workflow.md` §2 and needs no server shape.

- `DeployStages` takes a current stage and an optional condition (`waiting` / `fixing` / `action` / `failed`) and draws the eight stages with a word on each (done / in progress / waiting), so colour is never the only signal. The parent maps whatever the server returns onto these keys.
- Stage keys are UI keys, not server values. If #98 names the stages differently or has a different set, only the mapping changes.

## Todo

- [x] Stage display: eight stages in order, done / in progress / waiting, the four conditions in words, `aria-current` on the current stage — files: `deploy/DeployStages.tsx`, `deploy/stages.ts`
- [ ] Start button (#44 API): show the reason the server gives when not ready or already running — blocked on the contract
- [ ] Progress read and polling: only while in progress, interval from the BE doc, stop when leaving the screen, loading indicator — blocked on the contract
- [ ] Done: public address as a link with a copy button, scan warnings shown without blocking (UC-10) — blocked on the contract
- [ ] Failure: show the server's reason; say it is not the student's fault for platform problems — blocked on the contract
- [ ] Find an in-progress deploy again after a reload through the deploy list — blocked on the contract
- [ ] Mutation testing (#67 not introduced; hand mutants on the stage logic were run)
- [ ] Screenshots (light and dark, 1440px and 390px) — attached by the user

## Done when

A student can start a deploy, watch the stages change, and get the public address or the failure reason, and can come back to it after a reload. This branch alone does not reach that.
