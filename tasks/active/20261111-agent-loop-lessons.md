# Agent loop — lessons

## Log

- 2026-11-11: pydantic-ai 2.66 is newer than what the plan assumed; read its source for `MCPToolset`, `FunctionModel`, `FallbackModel` and `WrapperModel` before writing code, and spiked the gateway rejection path in the scratchpad.
- 2026-11-11: `MCPToolset` maps an `isError` result to a text `ModelRetry`, so stop codes could not be told apart. Subclassed it and overrode `direct_call_tool`.
- 2026-11-11: The fake gateway needs FastMCP's server extra (`fastmcp-slim[server]`), added as a dev dependency only.
- 2026-11-11: Redaction first drafts: a dict value checked alone loses its key (`{"API_KEY": "k1"}`), and the key=value pattern masked `Bearer` instead of the token after `Authorization:`. Fixed: secret-named keys mask their string value; the Authorization pattern runs first and the key=value pattern skips `[REDACTED]`, scheme words and JSON arrays/objects.
- 2026-11-11: Checks run only in the test session from F10 on; this branch was written without running ruff/mypy/pytest here.
- 2026-11-11: User decision: apply the local-model 16K budget on this branch (new commits). Cut on receipt (line 400 chars, log 24KB, big raw objects to key fields), prompts from a digest instead of the ticket JSON (the planner gets the same digest, since a failed API call falls back to the local model), tool results excerpted, older tool results summarized by a history processor, thinking off + max_tokens for local tool calls.
- 2026-11-11: First measurement of the biggest test ticket gave 46–48K chars per local request: the event list in tool results (50 events × 400 chars) dominated. Tool-result events now follow the digest rule (reason · message, distinct, latest 10); the worst request is about 23K chars against the 30K estimate.
- 2026-11-11: #109 (W6 failures not sent to the AI) was not on team `main` yet; not read here. The ticket contract keeps four stages.

## Lessons

- Measure the prompt size with the biggest realistic input before choosing limits; the first guess missed the largest contributor.
- Read the installed library's code before designing around it when its version is newer than your knowledge (noted in [`AI/CLAUDE.md`](../../AI/CLAUDE.md) pitfalls for the MCP error mapping).
