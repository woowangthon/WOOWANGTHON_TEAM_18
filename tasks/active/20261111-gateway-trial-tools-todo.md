# Gateway: trial tools run_render · run_deploy · run_verify (F11b-1, B1)

- **SRS**: UC-14 (P0) — FR-076, FR-098, FR-099, demo step 7
- **Owner**: track B (AI agent), BE side
- **Branch**: feat/gateway-trial-tools (from team `main` 700a4e7)

## Plan

Contract: `docs/design/api.md` "파이프라인 ↔ 플랫폼 서버" 4 (merged in #147, ADR-014). No contract change.

- `GatewayTrials` (BE memory): schedule `student-trial` with `DEPLOY_ID` · `TRIAL_ID` · `TRIAL_STAGES`, wait for the result up to the cap, cancel the running stages of a leftover instance (by the `counter` the input read reported), cancel every unfinished instance at BE start, refuse the next trial while an earlier one could not be confirmed stopped (`TRIAL_STILL_RUNNING`).
- Routes `GET /api/pipeline/trials/:trialId/input?counter=` and `POST /api/pipeline/trials/:trialId/result` with the pipeline token.
- Gateway tools: trial input = run input with every service `reuse` + digest, `specPatch` checked (runtime only in B1, live path protection, `validateSpec`), `run_verify` uses the last successful `run_deploy` input. Token expiry raised when a wait starts and rewritten when it ends, waits left out of the 15-minute work budget, 60-minute ticket cap, per-tool counts.
- Stale check: a `fixing` run with a live gateway token is not timed out (one condition in `deploy-runs.service.ts`, nothing else touched there).
- Out of scope: `run_build` (B3), `verified` (B2), pipeline side (`student-trial` YAML, `trial-report`, fetch-input branch).

## Todo

- [x] GoCD client: pipeline name, trial run, stage cancel, cancel all — files: `BE/src/deploys/pipeline.client.ts`, `BE/src/config/env.ts`, `BE/.env.example`
- [x] Trials and routes — files: `BE/src/gateway/trials.ts`, `BE/src/gateway/trials.controller.ts`, `BE/src/gateway/gateway.module.ts`, `BE/src/deploys/deploys.module.ts`
- [x] specPatch — files: `BE/src/gateway/spec-patch.ts`
- [x] Tools, budget, ticket expiry — files: `BE/src/gateway/tools.ts`, `BE/src/gateway/budget.ts`, `BE/src/gateway/tickets.ts`, `BE/src/deploys/deploys.store.ts` (`findLastSucceededRun`)
- [x] Stale check — files: `BE/src/deploys/deploy-runs.service.ts`
- [x] Tests — files: `BE/src/gateway/{budget,spec-patch,trials}.spec.ts`, `BE/src/deploys/pipeline.client.spec.ts`, `BE/src/config/env.spec.ts`, `BE/test/gateway.e2e.spec.ts`, `BE/test/gateway-trials.e2e.spec.ts`, `BE/test/deploy-runs.e2e.spec.ts`, `BE/test/spec-fixture.ts`
- [x] Docs — files: `docs/design/api.md`, `docs/design/AIagent.md`, `docs/ai-scope.md`

## Done when

- [ ] `pnpm verify` in `BE/` passes — PASS from the test session
- [x] An SDK MCP client over real HTTP runs run_deploy → the fake pipeline reads the patched all-reuse input and posts a result → the tool answers it masked; run_verify reads the last deploy input; refusals happen before anything is scheduled
- [ ] mutation testing — not run (checks run only in the test session); said in the PR
