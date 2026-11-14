# Student deploy explanation (AI) — lessons

## Log

- 2026-11-14: implemented AI / BE / FE behind `DEPLOY_EXPLAIN_ENABLED` (off). `toAgent` moved to `deploy-run.ts` so the explainer can use it without an import cycle with `deploy-runs.service.ts`. Tests written and run by a delegated sub-agent per area.
- 2026-11-14: ran `/code-review medium` and `/simplify`. Applied behaviour-preserving cleanups (shared `strOrNull`, `text()` reuses `clean()`, `Spec`/`ServiceConditions` types instead of a hand copy, no body read on non-200, dropped the `toAgent` re-export). Left open: internal-name masking also hides student service names (`proj-*`), `AGENT_UNAVAILABLE` counted as a student failure, double masking passes, no concurrency cap on explanation calls.

## Lessons

- PydanticAI `NativeOutput` answers come back as a text part, not a tool call; `tests/scripted.py` got a `text(...)` step for it.
