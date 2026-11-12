# Agent: W6 verify failures — cases V1 · V2

- **SRS**: UC-14 (P0) — FR-076, FR-098, demo step 7
- **Owner**: track B (AI server)
- **Branch**: feat/agent-verify-stage (from team `main` 69bd156, team `main` 79c173b merged in)

## Plan

User decision (2026-11-11): keep ADR-012 and hand W6 (verify) failures to the agent. #109 already added `verify` to the ticket `stage` and fixed its raw shape: `raw = { codebuild: null, k8s: { pod, events, status: null } }`, with the one failed check (path and response status, or a not-Ready Pod / empty endpoints) in `errorMessage` (AIagent.md §5, BE `checkEvidence`). This branch follows that contract and adds what is left:

- Check that verify tickets reach the model well: the digest already carries `errorMessage`, the Pod's container states and the events.
- Cases `V1` (static file 404 → Vite `base` · `outputDir`; a repo fix is `needs_user` until the PR tools exist) and `V2` (API path 404 → `stripPrefix` · `ingressPath` · `health.path`), matched by regex on the path and status in `errorMessage`.

A first version on this branch (9f74719) added a third raw shape `raw.verify` and a `contains` match test. The coordinating session corrected that (the contract is set by #109 · #107, and track A's F05 follows it); the merge of team `main` and the next commit put the contract files back to `main` and drop `raw.verify` and `contains`.

## Todo

- [x] Cases V1 · V2 — files: `AI/ai_server/agent/cases.json`
- [x] Tests — files: `AI/tests/test_memory.py`, `AI/tests/test_agent_loop.py`
- [x] Docs — files: `docs/design/AIagent.md` §8 + known limits, `docs/ai-scope.md`

## Done when

- [ ] ruff, mypy strict, pytest pass — PASS from the test session
- [x] V1 · V2 are found from the failed check in `errorMessage`; a page 404, a 500 / 502 and not-Ready messages are not
- [ ] mutation testing — not run (checks run only in the test session); said in the PR
