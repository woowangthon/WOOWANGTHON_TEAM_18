# Prepare and Apply stages (W5)

- **SRS**: FR-049~058 (UC-07 build, deploy, check), FR-055 (live slot untouched on failure)
- **Owner**: suda5936
- **Branch**: feat/prepare-apply-stage

## Plan

Two stage CLIs in `Infra/pipeline` on the k3s API (the executor role `proj-deployer` from #114: write the app kinds, read Pods · events · ReplicaSets, no logs, no deletecollection). Prepare: live slot protection from the open Ingresses (`wanggane/ingress=open`; same as target or mixed → platform `LIVE_SLOT_PROTECTED`), `checkQuota` (student problem with no Status, case P2), clear the target slot by label one object at a time, drop test Ingresses of services no longer public. Apply: server-side apply AI → BE → FE from Render's `slot.yaml`, poll every 3 s until Ready (startupTimeoutSeconds + 120 s, max 420 s), fail fast on CrashLoopBackOff · OOMKilled · quota FailedCreate · ImagePullBackOff/ErrImagePull, keep the failed Pod and slot events (managedFields stripped). One failure shape for all stages (`src/failure.ts`): `platform` with a code string, or `student` with ticket `raw.k8s`; Render's dry-run refusals are split the same way (namespace 404, RBAC 403, `wanggane-*` policy → platform). Platform code names are matched to #107 later in the notify task. Not here: GoCD YAML, notify tasks, artifact passing, `deploy_state`.

## Todo

- [x] Failure shape and refusal classifier — files: `src/failure.ts`
- [x] k3s helpers: get/list/delete/apply — files: `src/kube.ts`
- [x] Prepare — files: `src/prepare.ts`, `src/cli/prepare.ts`
- [x] Apply — files: `src/apply.ts`, `src/cli/apply.ts`
- [x] Render failures as platform / student — files: `src/render.ts`, `src/cli/render.ts`
- [x] Docs — files: `docs/design/deploy-workflow.md`, `docs/ai-scope.md`, `Infra/pipeline/CLAUDE.md`

## Done when

- [x] Prepare and Apply run against a k3s with the student space and an executor-only token (clear, apply, timeout, missing permission)
- [x] tests added; hand-made mutants killed or explained
- [ ] fast-fail signals seen on a cluster where Pods run (the leader)
