# Agent loop — lessons

## Log

- 2026-11-11: pydantic-ai 2.66 is newer than what the plan assumed; read its source for `MCPToolset`, `FunctionModel`, `FallbackModel` and `WrapperModel` before writing code, and spiked the gateway rejection path in the scratchpad.
- 2026-11-11: `MCPToolset` maps an `isError` result to a text `ModelRetry`, so stop codes could not be told apart. Subclassed it and overrode `direct_call_tool`.
- 2026-11-11: The fake gateway needs FastMCP's server extra (`fastmcp-slim[server]`), added as a dev dependency only.
- 2026-11-11: Redaction first drafts: a dict value checked alone loses its key (`{"API_KEY": "k1"}`), and the key=value pattern masked `Bearer` instead of the token after `Authorization:`. Fixed: secret-named keys mask their string value; the Authorization pattern runs first and the key=value pattern skips `[REDACTED]`, scheme words and JSON arrays/objects.
- 2026-11-11: Checks run only in the test session from F10 on; this branch was written without running ruff/mypy/pytest here.
- 2026-11-11: A coordination race: the budget commit (4ca6007) was pushed before the correction that it belongs to a later PR arrived; reverted with 81efffa (same tree as b0c5ca9, force push is blocked here). The work stays on a local branch.
- 2026-11-11: Review of #110: gateway failures and a rejected submit used to escape `solve()` and only reach the log, so the platform waited for its own 1-hour timeout. Now transport errors become a `gave_up` that says so, the submit is retried (2/5/10 s), `INVALID_RESULT` gets one minimal `gave_up`, repeated gateway rejections are no longer called a model failure, and missing model settings no longer stop the boot.

## Lessons

- Read the installed library's code before designing around it when its version is newer than your knowledge (noted in [`AI/CLAUDE.md`](../../AI/CLAUDE.md) pitfalls for the MCP error mapping).
