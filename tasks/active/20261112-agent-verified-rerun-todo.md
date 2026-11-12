# Gateway: verified → re-run student-deploy (F14, B2)

- **SRS**: UC-14 (P0) — FR-076, FR-098, FR-099, demo step 7
- **Owner**: track B (AI agent), BE side
- **Branch**: feat/agent-verified-rerun (from team `main` 2feae58)

## Plan

Contract: `docs/design/api.md` "파이프라인 ↔ 플랫폼 서버" 5 (ADR-014). No contract change; the doc now says how it is implemented.

- `submit_result` takes `verified` with a `specPatch` array (empty after a plain re-run). The patch goes through `applySpecPatch` (`PATCH_FORBIDDEN` · `INVALID_SPEC`), and the patched trial input must equal the input of the last successful `run_deploy` that a later `run_verify` passed (`GatewayTrials.verifiedInput`); otherwise `INVALID_RESULT`. A later `run_deploy` drops that record.
- On accept: end the ticket (cancel waiting trials), check earlier trials ended (one retry after 3 s), else `failed TRIAL_STILL_RUNNING` + `close(stopped)`. Then the run goes `fixing → running`, `stage build`, `failure null`, token hash null, `input` = the checked input (every service `reuse` + digest), `ticket_id` kept; schedule `student-deploy` (fail → `failed PIPELINE_UNAVAILABLE` + `close(stopped)`).
- Ticket count in `agent_result.tickets` (no migration). `deploy-runs.service`: switch passed with a ticket → `close(success)`; platform failure with a ticket → `close(stopped)`; student failure on a re-run → `close(superseded)` + new ticket with `previous`, or `failed AGENT_GAVE_UP` + `close(stopped)` past 3 tickets; a stale `running` re-run with a ticket → `close(stopped)` on `TIMED_OUT`.
- Images: the re-run's build pass writes `images: {}`; trial inputs of a later ticket take the image from `input.deploy_condition` (every service is `reuse` there), so #153's build_cache handling needs no change.
- Out of scope: `run_build` and build-path patches (B3), pipeline side.

## Todo

- [x] Result check — files: `BE/src/gateway/result.ts`
- [x] Verified record and settle check — files: `BE/src/gateway/trials.ts`
- [x] verified submit and re-run — files: `BE/src/gateway/tools.ts`, `BE/src/deploys/deploys.store.ts` (`input` in the run patch)
- [x] Ticket count, close rules, previous — files: `BE/src/deploys/deploy-run.ts`, `BE/src/deploys/deploy-runs.service.ts`
- [x] Tests — files: `BE/src/gateway/result.spec.ts`, `BE/src/deploys/deploy-run.spec.ts`, `BE/test/gateway.e2e.spec.ts`, `BE/test/gateway-trials.e2e.spec.ts`, `BE/test/deploy-runs.e2e.spec.ts`, `AI/tests/fake_gateway.py`, `AI/tests/test_agent_loop.py`
- [x] Docs — files: `docs/design/api.md`, `docs/design/AIagent.md`, `docs/ai-scope.md`

## Done when

- [x] `pnpm verify` in `BE/` and the AI verify line pass — PASS from the test session (d6c2d62: 35 files, 1463 passed, 1 skipped; AI 286 passed at cab2e83)
- [x] An SDK MCP client runs run_deploy(patch) → run_verify → submit verified, and the run is `running` from `build` with the checked input and `student-deploy` scheduled; every refusal leaves the run `fixing`
- [x] mutation testing — 8 hand mutants run by the test session; two survived at first (the run_verify record condition, a negative ticket count), tests added, all caught
