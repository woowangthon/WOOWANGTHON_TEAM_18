# Agent: trial run contract (F11b, docs only)

- **SRS**: UC-14 (P0) — FR-076, FR-098, FR-099, demo step 7
- **Owner**: track B (AI agent)
- **Branch**: docs/agent-trial-contract (from team `main` a9dafd8)

## Plan

User decision (2026-11-11): split F11b and land the contract first, no code. Both tracks' proposals merged by the coordinating session:

- A separate GoCD pipeline `student-trial` (leader executor, Prepare → Render → Apply → Verify, no Build or Switch). `student-deploy` stays as it is; its YAML is the GoCD owner's.
- BE schedules it with `DEPLOY_ID` · `TRIAL_ID` · `TRIAL_STAGES`; a stage outside the list ends at once; the Switch CLI refuses with `TRIAL_SWITCH_REFUSED` when `TRIAL_ID` is set.
- Input `GET /api/pipeline/trials/:id/input` in the same shape as the deploy input; result `POST /api/pipeline/trials/:id/result` `{ stage, result }` with `result` in the tool's shape plus `failure`. The run's state machine is untouched.
- Gateway: `run_render` · `run_deploy` · `run_verify`, 30 min wait outside the 15 min budget, one trial at a time, build-path patches `PATCH_FORBIDDEN`, `source` `INVALID_ARGUMENT`.
- Trials live in BE memory (no migration); a restart cuts the waiting call.
- After `verified` (user decision 2026-11-11, second commit set): save the patched spec in the run's `input` (all services `reuse`), set the run back to `running` / `build`, and schedule `student-deploy` again; its Verify is the re-check, then Switch · W7 as usual. `build_cache` moves to build passed (contract here; the code change is the #107 owner's own PR). Up to 3 tickets per run (user, 2026-11-11), then `failed` (`AGENT_GAVE_UP`). `deploys.spec` stays as the student confirmed it.

## Todo

- [x] Contract — files: `docs/design/api.md` ("파이프라인 ↔ 플랫폼 서버" 4, gateway notes)
- [x] Design notes — files: `docs/design/AIagent.md` §2 + known limits, `docs/design/deploy-workflow.md` §3 · §8
- [x] Pipeline side review from track A before push (OK after three additions: run_verify input, per-job input read, STAGE_NO_REPORT)

## Done when

- [x] Track A confirms the pipeline side; markdown links resolve
- [x] `verified` re-run contract — files: `docs/design/api.md` (3 · 5), `docs/design/AIagent.md` §1 · §6 · §7, `docs/design/deploy-workflow.md` §6
- [x] Track A confirms the re-run part (all-reuse build passes with `images: {}`)
- [ ] Next PR: BE implementation (trial routes, gateway run tools, `verified` re-run, without the build_cache move, which the #107 owner does)
