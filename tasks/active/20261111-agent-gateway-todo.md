# Agent: BE MCP gateway (F11, pipeline-free part)

- **SRS**: UC-14 (P0) — FR-076, FR-098, FR-099, FR-101
- **Owner**: track B (AI agent), BE side
- **Branch**: feat/agent-gateway (stacked on feat/agent-verify-stage, team `main` 79c173b merged in)

## Plan

User decision (2026-11-11, option A): open only what works without the pipeline. The pipeline cannot run a trial build or deploy yet (track A, F11b), so the run tools would be fake.

- MCP Streamable HTTP, stateless, on `GATEWAY_PORT` (internal, must differ from `PORT`) at `POST /mcp`.
- Token: `Authorization: Bearer gw_…` → sha256 → `deploy_runs.gateway_token_hash`; run must be `fixing`, not expired (15 min, #107). Else `TICKET_CLOSED`.
- Limits in BE memory: 20 calls, 15 min, same call 2 in a row (`TOOL_LIMIT` · `TIME_LIMIT` · `REPEATED_CALL`). `submit_result` is not counted.
- Tools: `get_target_status`, `read_pod_logs`, `read_repo`, `submit_result`. Run · operation tools and `read_build_logs` come in F11b; `edit_repo_file` · `open_pr` in F13.
- `submit_result`: §6 check; `verified` (and `specPatch` · `buildOverrides`) is `INVALID_RESULT` until F11b. `gave_up` → run `failed` with `AGENT_GAVE_UP`; `pr_opened` · `needs_user` → `needs_user`. Token cleared.
- AI close notice: a stale `fixing` run expired as TIMED_OUT sends `close(stopped)`.

## Todo

- [x] Gateway — files: `BE/src/gateway/*`, `BE/src/main.ts`, `BE/src/app.module.ts`, `BE/src/config/env.ts`, `BE/.env.example`
- [x] Cluster raw reads · previous logs — files: `BE/src/k8s/cluster-reader.ts`
- [x] Store lookup by token hash, `AGENT_GAVE_UP`, close notice — files: `BE/src/deploys/*`
- [x] Tests — files: `BE/src/gateway/*.spec.ts`, `BE/src/config/env.spec.ts`, `BE/src/k8s/cluster-reader.spec.ts`, `BE/test/gateway.e2e.spec.ts`, `BE/test/deploy-runs.e2e.spec.ts`
- [x] Docs — files: `docs/design/api.md` (gateway), `docs/design/AIagent.md` known limits, `docs/ai-scope.md`
- [ ] Pending contract answer: where the student sees the agent result (`agent_result` column, status API `agent`) — proposed to the coordinating session

## Done when

- [ ] `pnpm verify` in `BE/` passes — PASS from the test session
- [x] An SDK MCP client over real HTTP lists exactly the four tools, reads status · logs · repo with secrets masked, gets `TICKET_CLOSED` for bad · expired · closed tokens, and its result changes the run once
- [ ] mutation testing — not run (checks run only in the test session); said in the PR
