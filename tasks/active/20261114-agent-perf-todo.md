# AI agent performance pass (before/after measured on the live service)

- **SRS**: FR-075~FR-077, FR-098~FR-102
- **Owner**: suda5936
- **Branch**: claude/determined-cray-3gq1oy

## Plan

Apply only the items of the perf note that the code confirms; no ADR change. Measure before (prod `wcp-ai:4385d98`) and after (this branch, deployed after merge) on the live service with real broken repos (`suda5936/WOOWANGTHON_TEST_2`: `main` = A1 port, `bench/b3-build-env`, `bench/b4-import-case`, `bench/b5-copy-missing`). Sources: `wcp-ai` trace log (SSM), `deploy_runs` rows, vLLM `/metrics` token counters.

Applied: playbooks only use gateway tools (no `read_build_logs` / `edit_repo_file` / `open_pr`; repo fixes end in `needs_user`), instructions match gateway rules (name/slug forbidden, per-tool limits, remaining calls in the replan prompt), code fills the `verified` specPatch from the passing trial, B2 regex narrowed and moved after B5/B3/B4, ticket logs noted so the first observation step can be skipped, usage + time on the trace line.
Not applied: planner timeout/max_tokens (no measurement to pick values; a reasoning model's output could be cut), history compaction, `read_memory` trim, temperature (all wait for measurement).

## Todo

- [ ] baseline runs on prod (A1, B3, B4, B5w)
- [ ] code changes + tests — files: `AI/ai_server/agent/{cases.json,prompts.py,loop.py}`, `AI/tests/*`
- [ ] PR, merge, `deploy-ai.sh`
- [ ] after runs on prod, same repos
- [ ] test log (Claude Docs) + `docs/ai-scope.md`

## Done when

- [ ] before/after numbers for every scenario in the test log
- [ ] `uv run` verify green; mutation survivors resolved or explained
