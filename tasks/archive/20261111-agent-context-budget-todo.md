# Agent context budget (local model 16K)

- **SRS**: UC-14 (P0) — FR-076, FR-099, FR-101 (the agent has to fit the local model to work at all)
- **Owner**: track B (AI server)
- **Branch**: feat/agent-context-budget (from team `main` 61d6478, after #110)

## Plan

User decision (2026-11-11, via the coordinating session): the AI server keeps the local model (vLLM, `--max-model-len 16384`, input + output) under budget itself instead of relying on what the platform sends (#107 builds the tickets). Target about 10K input tokens, estimated by characters until vLLM is connected.

1. Cut on receipt (`budget.py`): log line 400 chars, log 24KB keeping the last lines, `raw.*` over 6,000 chars reduced to key fields; the fact is written into the prompt. Code classification still uses the original ticket.
2. Prompt (`prompts.py`): a digest instead of the ticket JSON — error · stage · service · case, log excerpt (error context + last 20, max 60 lines), container states, events (reason · message, distinct, latest 10), Render Status. The planner gets the same digest because a failed API call falls back to the local model.
3. Tool results: logs excerpted, events latest 10, big raw objects to key fields, noted in `_truncated`. The `actions` record keeps the original.
4. History: a PydanticAI history processor keeps the latest tool result whole and turns older ones into one-line summaries.
5. Local model settings: Qwen3 thinking off (`chat_template_kwargs.enable_thinking=false`) and `max_tokens` 2048 for tool calls; thinking on and 4096 when the local model plans.

The work was first written on `feat/agent-loop` (4ca6007) and reverted there (81efffa) when the user decided it is its own PR; this branch carries it over onto the merged #110 code.

## Todo

- [x] Cut on receipt, excerpt, tool-result trimming, history compaction — files: `AI/ai_server/agent/budget.py`
- [x] Digest prompts — files: `AI/ai_server/agent/prompts.py`
- [x] Wiring (trim before prompts, history processor, local model settings) — files: `AI/ai_server/agent/loop.py`, `AI/ai_server/agent/gateway.py`
- [x] R3 note that render quota errors are rare (track A, #113) — files: `AI/ai_server/agent/cases.json`
- [x] Tests — files: `AI/tests/test_budget.py`, `AI/tests/test_agent_loop.py`
- [x] Docs — files: `docs/design/AIagent.md` §10 + known limits, `docs/design/api.md`, `docs/ai-scope.md`

## Done when

- [ ] ruff, mypy strict, pytest pass — PASS from the test session
- [x] the biggest test ticket and tool results keep every local-model request under 30,000 chars (measured: largest about 24K)
- [ ] mutation testing — not run (checks run only in the test session); said in the PR
