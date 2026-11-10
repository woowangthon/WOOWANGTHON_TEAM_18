# Agent contract: models, initial cases, ticket API

- **SRS**: none yet — "배포 실패 문제 해결 에이전트" is "FR 미정" in [`docs/ai-scope.md`](../../docs/ai-scope.md) §2; design in [`docs/design/AIagent.md`](../../docs/design/AIagent.md) §5 – §8, contract in [`docs/design/api.md`](../../docs/design/api.md) "AI 에이전트"
- **Owner**: track B (AI server)
- **Branch**: feat/agent-contract (on top of feat/ai-server-setup)

## Plan

Put the platform ↔ AI contract into code so track A can call the AI server before the agent exists.

- Pydantic models for the ticket (§5), the result (§6, with the `specPatch` path pattern and the per-status required field), and the close notice (§7). camelCase on the wire, unknown keys rejected, every ticket key required (`null` when empty), raw CodeBuild / k3s objects kept as free JSON.
- The 15 initial cases (§8 table) as data in `cases.json`, loaded and validated at boot. `match` is a small condition tree over JSON paths (`equals` / `notEquals` / `regex`, `all` / `any`) — the §8 example (`messageRegex`) needed a second field of the same event, so the format became a tree and the example in AIagent.md follows it. Code classification (①) takes cases of the ticket's stage in file order, first match wins; narrower cases come first.
- `POST /agent/tickets`: bearer `AGENT_API_TOKEN` (constant-time compare) → JSON object → model → 202 `{ticketId}`. The same `ticketId` again returns the same 202 and starts nothing. Too many running → 503 `AGENT_BUSY` (`AGENT_MAX_RUNS`, default 2). `400 INVALID_TICKET` lists fields like `INVALID_SPEC` (paths relative to the body: `ticket.raw.k8s.events[0]`).
- `POST /agent/tickets/{ticketId}/close`: 204; stops a running task; `success` adds one to `stats.solved` of the case the run used, once. Unknown ticket → 204. Body `ticketId` must equal the URL's (`MISMATCH`).
- Runs are asyncio tasks in an in-memory registry (lost on restart, said in code). Until F12 the runner only classifies; it submits no result, so nothing fake reaches the platform.

## Todo

- [x] Models — files: `AI/ai_server/agent/models.py`, `AI/tests/test_models.py`
- [x] Cases + classification — files: `AI/ai_server/agent/memory.py`, `AI/ai_server/agent/cases.json`, `AI/tests/test_memory.py`
- [x] Ticket and close API, run registry, error shape — files: `AI/ai_server/agent/api.py`, `AI/ai_server/agent/runs.py`, `AI/ai_server/errors.py`, `AI/ai_server/main.py`, `AI/ai_server/config.py`, `AI/tests/test_tickets_api.py`
- [x] Docs — files: `docs/design/AIagent.md` §8 + known limits, `docs/ai-scope.md`, `AI/CLAUDE.md`, `AI/.env.example`

## Done when

- [x] ruff, mypy strict, pytest pass (161 tests)
- [x] every case in the §8 table is found by a ticket carrying its signal; tickets of another stage or without a signal are not
- [x] api.md behaviours each have a test: 401, 400 BAD_REQUEST / INVALID_TICKET fields (≤20) / INVALID_CLOSE, 202 and resend, 503, 204 close (success counted once, others not, unknown ticket)
- [x] tests added; hand mutants (64, run without bytecode cache) all killed or removed as dead code
