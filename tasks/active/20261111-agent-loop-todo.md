# Agent loop (PydanticAI agent over the MCP gateway)

- **SRS**: UC-14 (P0) — FR-076, FR-077, FR-099, FR-101, FR-102 (FR-075 · FR-098 · FR-100 are the platform's side)
- **Owner**: track B (AI server)
- **Branch**: feat/agent-loop (from team `main` f21820d)

## Plan

Replace the F10 placeholder runner with the real agent, as designed in [`docs/design/AIagent.md`](../../docs/design/AIagent.md) §1 – §3 and §9, and documented as built in §10.

- Flow: ① code classification (F10) → ② local-model classification over the cases of the ticket's stage (an id not in that list counts as unknown) → ③ playbook with the local model → ④ replan with the reasoning model when ③ gives up / ⑤ planning with the reasoning model for an unknown failure.
- The model's `output_type` is the part of the result it decides (`Outcome`: status, specPatch, pr, userRequest, evidence, summary); a wrong shape is regenerated (2 retries). Code adds the envelope (ticketId, commitSha, classification, actions = the real gateway calls) and calls the gateway's `submit_result` once; the model never gets `submit_result`.
- Gateway: `MCPToolset` over Streamable HTTP at `GATEWAY_URL`, the ticket's gateway token as Bearer, 35 min call timeout. Subclassed to read rejections with their `code`: `TOOL_LIMIT` · `TIME_LIMIT` · `LIVE_SLOT_PROTECTED` stop the run with a `gave_up` that says why and what to do (FR-101); `TICKET_CLOSED` submits nothing; other codes go back to the model.
- `read_memory` is a local tool (contract agreed in F10).
- Models: OpenAI-compatible, from env (`LOCAL_MODEL_*` required, `PLANNER_MODEL_*` optional). Planner = `FallbackModel(RedactingModel(api), local)`; without an API the local model plans.
- FR-102: `RedactingModel` masks secret-looking strings in every message part sent to the reasoning API. Not applied to the local model.
- Model failure → `gave_up` saying so (no plausible fake, F-1).
- Everything sent to the model is built in `prompts.py`, so the 16K context budget (pending a user decision) can go there.

## Todo

- [x] Result model split (`Outcome` / `AgentResult`, `to_wire`) — files: `AI/ai_server/agent/models.py`
- [x] Model settings + validation — files: `AI/ai_server/config.py`, `AI/.env.example`, `AI/tests/test_config.py`
- [x] Gateway toolset, stop codes, submit — files: `AI/ai_server/agent/gateway.py`, `AI/tests/test_gateway.py`, `AI/tests/fake_gateway.py`
- [x] Redaction — files: `AI/ai_server/agent/redact.py`, `AI/tests/test_redact.py`
- [x] Prompts + loop + runner wiring — files: `AI/ai_server/agent/prompts.py`, `AI/ai_server/agent/loop.py`, `AI/ai_server/main.py`, `AI/ai_server/agent/runs.py`, `AI/tests/test_agent_loop.py`, `AI/tests/scripted.py`, `AI/tests/conftest.py`
- [x] Docs — files: `docs/ai-scope.md`, `docs/design/AIagent.md` §10 + known limits, `AI/CLAUDE.md`, `AI/Dockerfile`

## Done when

- [ ] ruff, mypy strict, pytest pass — PASS from the test session
- [x] each path has a test with scripted models and the fake gateway: playbook, LLM classification, unknown → plan, replan after gave_up, stop codes, TICKET_CLOSED, other rejections back to the model, wrong output regenerated, model failure, fallback, redaction, API → submit_result end to end
- [ ] mutation testing — not run (checks run only in the test session); said in the PR
