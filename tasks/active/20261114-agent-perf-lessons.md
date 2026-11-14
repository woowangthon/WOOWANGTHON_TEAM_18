# AI agent performance pass — lessons

## Log

- 2026-11-14: checked the perf note against the code. Confirmed: B1–B5 playbooks name `read_build_logs`, B1/B4 `edit_repo_file`/`open_pr` (none exist in `BE/src/gateway/tools.ts`); prompt allows name/slug patches the gateway always rejects; `verified` specPatch must deep-equal the trial input; B2 regex matches the npm `EBADENGINE` warning. Also found `TOOL_LIMIT` is a stop code (no replan), and 6 of 44 vLLM requests so far ended with `finished_reason=length`.
- 2026-11-14: R1 cannot happen on the live service: `SERVICE_NAME` (`BE/src/deploys/deploy-input.ts`) already rejects names a k8s label would reject, so R1 is covered by unit tests only.
- 2026-11-14: baseline on prod. First two runs excluded: the bench script never wrote a secret, and `proj-<slug>` is only created by `ClusterSecretWriter.ensureSpace`, so a fresh slug with no secret keys fails Prepare with `EXECUTOR_FORBIDDEN` (A1) or gives the agent 403s (B3 `t_1df16dc6cd7d`). Re-ran with one unused secret key `BENCH_DUMMY` in both before and after. Results: A1 verified (4 tools, 236.7 s); B3 · B4 · B5w all `gave_up` on `TOOL_LIMIT` (B3 invented a `VITE_API_KEY` value; B4 once tried to patch `runtime.env` with the dummy key). B5w was classified B5, not B2 as expected.

## Lessons

- A new slug only gets its namespace when a secret is written; benches must write one (or the BE should create the space on start).

