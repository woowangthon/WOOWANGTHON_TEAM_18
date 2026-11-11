# Agent: W6 verify failures as tickets

- **SRS**: UC-14 (P0) — FR-076, FR-098 (W6 failures go to the agent, as the deploy workflow's W6 row says), demo step 7
- **Owner**: track B (AI server)
- **Branch**: feat/agent-verify-stage (from team `main` 69bd156)

## Plan

User decision (2026-11-11, via the coordinating session): keep ADR-012 and hand W6 (verify) failures to the agent too. The ticket contract had no `verify` stage, which #109 had resolved the narrow way; this adds it on the AI side. Making the pipeline (F05) and the platform (#107) send such tickets is not part of this PR.

- Contract (`api.md` "AI 에이전트", `AIagent.md` §5 · §8): `stage` gains `verify`; `raw` gets a third shape `{ codebuild: null, k8s: null, verify: { ready[], requests[] } }`, the W6 result of the deploy-workflow §4 check table. The `verify` key is optional for other stages so existing tickets stay valid.
- Model: `Stage` + `VerifyRaw`; the raw-shape check reports `REQUIRED` / `MUST_BE_NULL` field paths as before.
- Digest (F12b budget): a verify section with not-ready services and failed requests only, each distinct line once, at most 15.
- Cases: `V1` (asset 404 → `outputDir` patch, or a repo fix — `needs_user` until the PR tools exist) and `V2` (health 404 → `stripPrefix` · `ingressPath` · `health.path`). Both need two fields of the same request, so `match` gains a `contains` test (all `all` conditions may match different elements).

## Todo

- [x] Models and raw check — files: `AI/ai_server/agent/models.py`
- [x] `contains` condition, V1 · V2 — files: `AI/ai_server/agent/memory.py`, `AI/ai_server/agent/cases.json`
- [x] Digest verify section — files: `AI/ai_server/agent/prompts.py`
- [x] Tests — files: `AI/tests/test_models.py`, `AI/tests/test_memory.py`, `AI/tests/test_budget.py`, `AI/tests/test_tickets_api.py`, `AI/tests/test_agent_loop.py`
- [x] Docs — files: `docs/design/api.md`, `docs/design/AIagent.md`, `docs/ai-scope.md`

## Done when

- [ ] ruff, mypy strict, pytest pass — PASS from the test session
- [x] a verify ticket is accepted, a wrong raw shape names the field, V1 · V2 are found by their signals and not by a page 404 next to a 200 asset
- [ ] mutation testing — not run (checks run only in the test session); said in the PR
