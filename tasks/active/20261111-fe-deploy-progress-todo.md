# FE deploy start, progress and result address screen (#99)

- **SRS**: UC-08, FR-059 to FR-062, demo steps 6 to 8
- **Owner**: TaeTaeJin (FE session)
- **Branch**: feat/fe-deploy-progress

## Plan

Issue #99 waits for the BE progress read contract (#98) and the deploy start API contract (#44) in `docs/design/api.md`. Neither has landed, and SRS says the progress fields are "not decided". So this branch holds only the stage display, which comes from FR-060 and `deploy-workflow.md` §2 and needs no server shape.

- `DeployStages` only draws. It takes one state per stage (`pending` / `queued` / `active` / `done` / `skipped` / `fixing` / `action` / `failed`) and writes a word on each, so colour is never the only signal. Which stage may be in which state, which are skipped and whether a retry moves back are not decided here: they depend on the #98 contract, and the parent decides them.
- Stage keys and states are UI values, not server values. The parent maps the server's progress onto them; a server value the parent does not know must be handled there (a missing key would draw nothing for that stage).

## Todo

- [x] Stage display: eight stages in order, a word per state, `aria-current` on the stages that need attention — files: `deploy/DeployStages.tsx`, `deploy/stages.ts`
- [ ] Map the #98 progress response onto the per-stage states, including an unknown server value — blocked on the contract
- [ ] Start button (#44 API): show the reason the server gives when not ready or already running — blocked on the contract
- [ ] Progress read and polling: only while in progress, interval from the BE doc, stop when leaving the screen, loading indicator — blocked on the contract
- [ ] Done: public address as a link with a copy button, scan warnings shown without blocking (UC-10) — blocked on the contract
- [ ] Failure: show the server's reason; say it is not the student's fault for platform problems — blocked on the contract
- [ ] Find an in-progress deploy again after a reload through the deploy list — blocked on the contract
- [ ] Mutation testing (#67 not introduced; hand mutants on the stage logic were run)
- [ ] Screenshots (light and dark, 1440px and 390px) — attached by the user

## Done when

A student can start a deploy, watch the stages change, and get the public address or the failure reason, and can come back to it after a reload. This branch alone does not reach that.
