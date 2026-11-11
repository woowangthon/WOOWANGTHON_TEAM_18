# Deploy condition at W4 start (target slot, build input hash, run/reuse)

- **SRS**: none yet (SRS §4 has no FR for the deploy flow; track A F01 assigned by the coordination session)
- **Owner**: suda5936
- **Branch**: feat/deploy-condition

## Plan

At W4 start the platform server turns a saved deploy input (`deploys` row) into the deploy input of one run: target slot = the other side of `projects.live_slot` (A on the first deploy), and per service `buildInputHash` (context tree SHA + Dockerfile blob SHA + `spec.build` + default Dockerfile version) and run/reuse from `build_cache`. Pure rules in `deploy-condition.ts`, GitHub reads in `ReposService.sourceShas`, DB reads in `DeploysStore`. `prepare` stores nothing: the slot row is replaced by Prepare (F04), `build_cache` is written when a build finishes (F02/F06), `live_slot` by W7 (F07). Design: `docs/design/deploy-handoff.md`, `docs/design/deploy-workflow.md` §4, ADR-011.

## Todo

- [x] Migration: `projects`, `deploy_state`, `build_cache` with RLS on and no policies — files: `supabase/migrations/20261110120000_create_deploy_slots.sql`
- [x] Target slot, hash, image digest check, after-fill validation of `deploy_condition.services` — files: `BE/src/deploys/deploy-condition.ts`
- [x] Tree/blob SHAs of a commit (root tree from `git/commits`) — files: `BE/src/repos/repos.service.ts`
- [x] Store reads: deploy by id, live slot, cached image — files: `BE/src/deploys/deploys.store.ts`
- [x] `DeployConditionService.prepare` — files: `BE/src/deploys/deploy-condition.service.ts`
- [x] Docs — files: `docs/design/deploy-handoff.md`, `docs/design/deploy-workflow.md`, `docs/ai-scope.md`

## Done when

- [x] `prepare` returns the deploy input with slot and filled `deploy_condition.services` for the handoff example (fake GitHub and Supabase)
- [x] tests added; hand-made mutants killed or explained
- [ ] migration applied to the real Supabase project (needs a teammate with dashboard access)
