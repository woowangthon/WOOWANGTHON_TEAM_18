# Student deploy explanation (AI) — lessons

## Log

- 2026-11-14: implemented AI / BE / FE behind `DEPLOY_EXPLAIN_ENABLED` (off). `toAgent` moved to `deploy-run.ts` so the explainer can use it without an import cycle with `deploy-runs.service.ts`. Tests written and run by a delegated sub-agent per area.
- 2026-11-14: ran `/code-review medium` and `/simplify`. Applied behaviour-preserving cleanups (shared `strOrNull`, `text()` reuses `clean()`, `Spec`/`ServiceConditions` types instead of a hand copy, no body read on non-200, dropped the `toAgent` re-export). Left open: double masking passes, no concurrency cap on explanation calls.
- 2026-11-14: checked each review finding against code and tests. Fixed: `AGENT_UNAVAILABLE` is now skipped (the design already says failures whose ticket never reached the AI server are not explained), and the whole-body `maskInternal` pass is gone so student-chosen service names and paths (`proj-web`) are no longer masked; free text is still masked. The rest went to the PR's known limitations.
- Deferred structural cleanups from `/simplify` and `/code-review` (no behaviour change; follow-up refactor):
  - secret filter runs per field and again over the whole body;
  - `secretCount` re-attached because shared `redact` masks numbers under sensitive key names (fix in `common/redact.ts`);
  - `STUDENT_CODES` repeats the `classifyFailure` student/platform split;
  - `DeployExplainer.ask()` duplicates `AgentClient.post`;
  - `deploy_condition.services` cast duplicates `conditionsOf`;
  - materials and first-deploy flag travel through two side maps instead of the `ended` event or run row;
  - FE 3-minute wait deadline is separate from the BE 150 s timeout;
  - FE re-reads the full status endpoint every 3 s while waiting;
  - deploy-result notifier and explainer each re-read the run on `ended`;
  - AI `_cut` sits beside `budget.clip_line`;
  - length limits are written as literals on both AI and BE;
  - AI builds a new PydanticAI `Agent` per explanation request.

## Lessons

- PydanticAI `NativeOutput` answers come back as a text part, not a tool call; `tests/scripted.py` got a `text(...)` step for it.
