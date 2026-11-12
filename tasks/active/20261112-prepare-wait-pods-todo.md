# Prepare waits until the target slot's Pods are gone (F04b, #117)

- **SRS**: FR-052 (apply to the cluster), FR-055 (live slot untouched)
- **Owner**: suda5936 (track A)
- **Branch**: feat/prepare-wait-pods-gone

## Plan

#117: Prepare deletes the target slot's Deployments and Apply starts right away; the old Pods are still terminating (30 s grace) and still count in the ResourceQuota, so with three services the last new Pod gets `FailedCreate`.

Two options in the issue: (a) at the end of Prepare, list Pods `slot=<target>` until none is left; (b) delete with `propagationPolicy=Foreground` and wait for the Deployments to go. Chose (a): the executor role (`proj-deployer`, cluster.md §8) already lists Pods; (b) still needs a wait (on Deployments), and what holds the quota is the Pods, so (a) waits on the thing that matters and also covers Pods left by an interrupted trial. No permission change.

Limit 90 s (2 s polls): default grace 30 s + kubelet/API. Past it: platform code `SLOT_PODS_LINGERING` (open set) with the Pod names. The rerun after `verified` and trial `run_deploy` use the same Prepare, so this wait counts in the trial's 30-minute wait.

## Todo

- [x] Wait in Prepare — files: `src/prepare.ts`, `src/cli/prepare.ts`, `src/prepare.spec.ts`
- [x] Docs — files: `docs/design/deploy-workflow.md`, `Infra/pipeline/CLAUDE.md`

## Done when

- [ ] `pnpm verify` in `Infra/pipeline/` passes — PASS from the test session
- [ ] three services deploy on the leader without `FailedCreate` (needs the real cluster)
