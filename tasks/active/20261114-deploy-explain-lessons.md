# Student deploy explanation (AI) — lessons

## Log

- 2026-11-14: implemented AI / BE / FE behind `DEPLOY_EXPLAIN_ENABLED` (off). `toAgent` moved to `deploy-run.ts` so the explainer can use it without an import cycle with `deploy-runs.service.ts`. Tests written and run by a delegated sub-agent per area.

## Lessons

- PydanticAI `NativeOutput` answers come back as a text part, not a tool call; `tests/scripted.py` got a `text(...)` step for it.
