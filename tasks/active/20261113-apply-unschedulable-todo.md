# Apply: an unschedulable Pod at the limit is a platform problem (F04c)

- **SRS**: FR-098 (platform problems are reported, not handed to the agent)
- **Owner**: suda5936 (track A)
- **Branch**: feat/apply-unschedulable

## Plan

Today `waitReady` turns a Pod that never got a node into a student timeout (`not Ready in Ns`), so the agent gets a ticket it cannot solve. At the limit only (node room can free up, so no fast fail), a Pod of the service still `Pending` with `PodScheduled=False`, reason `Unschedulable`, fails as platform `SCHEDULING_FAILED` with the Pod and the slot events (FailedScheduling as evidence only; the Pod state decides, events expire). Signals and a quota FailedCreate keep their meaning. The project quota is smaller than one worker, so a Pod inside the quota that cannot be placed means the nodes are full. No contract change (the platform code set is open, AIagent.md §8 already lists FailedScheduling as a platform problem). BE gets one student sentence.

## Todo

- [x] Apply — files: `Infra/pipeline/src/apply.ts`, `apply.spec.ts`
- [x] notify / trial-report bodies accepted by BE — files: `notify.spec.ts`, `trial-report.spec.ts`
- [x] BE sentence — files: `BE/src/deploys/deploy-run.ts`, `deploy-run.spec.ts`
- [x] Docs — files: `docs/design/deploy-workflow.md`, `Infra/pipeline/CLAUDE.md`

## Done when

- [ ] `pnpm verify` in `Infra/pipeline/` and `BE/` — PASS from the test session
