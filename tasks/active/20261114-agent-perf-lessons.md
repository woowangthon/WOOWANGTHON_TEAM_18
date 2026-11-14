# AI agent performance pass — lessons

## Log

- 2026-11-14: checked the perf note against the code. Confirmed: B1–B5 playbooks name `read_build_logs`, B1/B4 `edit_repo_file`/`open_pr` (none exist in `BE/src/gateway/tools.ts`); prompt allows name/slug patches the gateway always rejects; `verified` specPatch must deep-equal the trial input; B2 regex matches the npm `EBADENGINE` warning. Also found `TOOL_LIMIT` is a stop code (no replan), and 6 of 44 vLLM requests so far ended with `finished_reason=length`.
- 2026-11-14: R1 cannot happen on the live service: `SERVICE_NAME` (`BE/src/deploys/deploy-input.ts`) already rejects names a k8s label would reject, so R1 is covered by unit tests only.
- 2026-11-14: baseline on prod. First two runs excluded: the bench script never wrote a secret, and `proj-<slug>` is only created by `ClusterSecretWriter.ensureSpace`, so a fresh slug with no secret keys fails Prepare with `EXECUTOR_FORBIDDEN` (A1) or gives the agent 403s (B3 `t_1df16dc6cd7d`). Re-ran with one unused secret key `BENCH_DUMMY` in both before and after. Results: A1 verified (4 tools, 236.7 s); B3 · B4 · B5w all `gave_up` on `TOOL_LIMIT` (B3 invented a `VITE_API_KEY` value; B4 once tried to patch `runtime.env` with the dummy key). B5w was classified B5, not B2 as expected.
- 2026-11-14: merged main with #206 (F13 `edit_repo_file` · `open_pr`, gateway now opens 10 tools), #207 (space ensured before start) and #209 (GitHub token). Conflicts in `prompts.py`, `test_agent_loop.py`, `ai-scope.md`. B4 goes back to the PR path (`edit_repo_file` → same `source` through `run_build` · `run_deploy` · `run_verify` → `open_pr`, `needs_user` on `BOT_UNAVAILABLE` / `patchAttached`); B1 stays `needs_user` (a lock file needs the package manager and rarely fits 50 lines). The merged instructions pushed the big-ticket local input to 30,118 chars (limit 30,000), so dropped the spec-validation sentence (the gateway returns `INVALID_SPEC` fields) and two parentheticals: 3,187 chars, below main. B4 before/after is no longer a pure agent comparison: the platform changed in between.

## Lessons

- When a PR removes something as "missing", check `main` again before merge: the missing tool can land meanwhile (#206 added the two tools this PR removed).
- A new slug only gets its namespace when a secret is written; benches must write one (or the BE should create the space on start).

