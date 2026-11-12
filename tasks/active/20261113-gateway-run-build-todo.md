# Gateway: run_build trial tool (F11b, B3)

- **SRS**: UC-14 (P0) — FR-076, FR-098, FR-099
- **Owner**: track B (AI agent), BE side
- **Branch**: feat/gateway-run-build (from team `main` fe599c3)
- **Issue**: #149 (decided: answer a reuse at once, no trial)

## Plan

Contract: `docs/design/api.md` "파이프라인 ↔ 플랫폼 서버" 4 · 5 and #149. No contract change.

- Trial input for every tool: apply `specPatch` (now `build` and `runtime`), recompute the build input hash only for services whose `build` changed (`DeployConditionService.buildHash`, same commit), pick the image run record → this ticket's trial image → `build_cache`. A service without an image is `INVALID_ARGUMENT` ("run_build first"); for `run_build` that service is `run`.
- `run_build(service, specPatch?, buildOverrides?)`: reuse → answer `{ ok, reused: true, ... }` at once (#149, counted, no wait); else schedule `student-trial` with `TRIAL_STAGES=build` and `buildOverrides` beside the input. A pass stores the image as the ticket's trial image and in `build_cache`.
- `buildOverrides` limits → `OVERRIDE_LIMIT`; shape → `INVALID_ARGUMENT`. Per-ticket count 2.
- Result shape for `run_build` in `trial-result.ts`; the pipeline's `trial-report.spec.ts` now checks run_build bodies with it too.
- `verified` with a build patch needs a trial image for each changed build (a run_build of it in this ticket).
- AI `BuildOverrides.timeout_minutes` le=20.

## Todo

- [x] Hash and result shape — files: `BE/src/deploys/deploy-condition.service.ts`, `BE/src/gateway/trial-result.ts`, `BE/src/deploys/pipeline.client.ts` (`TrialStages`)
- [x] Patch rules — files: `BE/src/gateway/spec-patch.ts`
- [x] Trial images, overrides in the input read — files: `BE/src/gateway/trials.ts`, `BE/src/gateway/budget.ts`
- [x] run_build, trial input, verified build check — files: `BE/src/gateway/tools.ts`
- [x] Tests — files: `BE/src/deploys/deploy-condition.service.spec.ts`, `BE/src/gateway/{spec-patch,trials,budget}.spec.ts`, `BE/test/gateway-trials.e2e.spec.ts`, `Infra/pipeline/src/trial-report.spec.ts`, `AI/tests/test_models.py`
- [x] AI — files: `AI/ai_server/agent/models.py`
- [x] Docs — files: `docs/design/api.md`, `docs/design/AIagent.md`, `docs/ai-scope.md`

## Done when

- [x] `pnpm verify` in `BE/` and `Infra/pipeline/`, and the AI verify line pass — test session at 24dfaa3: BE 1543 passed (one environment failure, `source-scanner.spec` under root, same on main), pipeline 660, AI 286
- [x] A build ticket goes run_build → run_deploy → run_verify → verified with the built image; a reuse answers without GoCD
- [x] mutation testing — 9 hand mutants run by the test session, all caught
