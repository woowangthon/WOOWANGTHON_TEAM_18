# AI/CLAUDE.md

The root [`CLAUDE.md`](../CLAUDE.md) rules apply; this file adds the commands and pitfalls of `AI/`.

## Commands

AI server (run in `AI/`, Python 3.12 — pinned in `AI/.python-version` and `requires-python`; [uv](https://docs.astral.sh/uv/) 0.11 manages Python, dependencies and `uv.lock`). Settings come from `AI/.env` (copy `AI/.env.example`); a bad value stops the server at boot, and the error names the variable but never prints its value:

| Task | Command |
| --- | --- |
| Install (CI-exact) | `uv sync --locked` |
| Dev server (port 8000, `127.0.0.1` unless `HOST` is set) | `uv run python -m ai_server` |
| Lint ([ruff](https://docs.astral.sh/ruff/)) | `uv run ruff check .` |
| Format (check / fix) | `uv run ruff format --check .` / `uv run ruff format .` |
| Typecheck ([mypy](https://mypy.readthedocs.io), strict, pydantic plugin; covers `tests/`) | `uv run mypy` |
| Test ([pytest](https://docs.pytest.org), FastAPI `TestClient`) | `uv run pytest` |
| Verify (run before every commit; stops at the first failure) | `uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest` |
| Add a dependency (updates `pyproject.toml` and `uv.lock`; add a `docs/ai-scope.md` row in the same commit) | `uv add <pkg>` / `uv add --dev <pkg>` |
| Container image (run from the repo root; the image binds `0.0.0.0:8000`) | `docker build -t ai AI` |

## Pitfalls

- **Never let pydantic's `ValidationError` text reach a log for settings.** Its message repeats the input value, which prints `AGENT_API_TOKEN`. `load_settings` rebuilds the message from `loc` and `msg` only; keep it that way when adding a secret setting.
- **Tests build settings with `_env_file=None`.** Otherwise a developer's `AI/.env` leaks into the test run.
- **Starlette's `TestClient` wants `httpx2`, not `httpx`.** With `httpx` every run prints a deprecation warning.
- **`to_camel` turns `k8s` into `k8S`.** Wire models get camelCase aliases from the generator; a name with a digit needs an explicit `Field(alias=...)`. Parsing still passed (by name), only the dump was wrong — assert dumped keys in tests.
- **Run hand-made mutants with `PYTHONDONTWRITEBYTECODE=1`.** A mutant the same size as the original, restored within the same second, leaves a `.pyc` that Python keeps using, so later runs test the mutant. Clear `__pycache__` before and after.
- **Use `with TestClient(app) as c` when a test needs background tasks.** Without the block each request runs on a fresh event loop and a task started by one request dies before the next one.
- **PydanticAI turns a gateway rejection (`isError`) into a plain-text `ModelRetry`.** The structured `code` is lost, so `GatewayToolset` overrides `direct_call_tool` and reads `client.call_tool(..., raise_on_error=False)` itself. Keep stop codes there.
- **FastMCP server support is a separate extra.** The app only needs the client (`pydantic-ai-slim[mcp]`); the fake gateway in tests needs `fastmcp-slim[server]` (dev dependency). Without it `from fastmcp import FastMCP` fails with a missing `uncalled_for`.
- **The fake gateway breaks the transport with `gw.broken[tool] = n`.** `_FakeToolset` overrides `GatewayToolset._raw_call`, so the real wrapping into `GatewayUnreachable` stays under test. Tests that hit submit retries set `loop.SUBMIT_RETRY_DELAYS` to zeros (`no_wait` fixture).
- **ruff's E501 counts East Asian characters as width 2.** A Korean line of 60 characters can be 110 columns; count width, not characters, when checking line length by hand.
- **Keep the local model in budget through `budget.py` and `prompts.py`.** Tickets and tool results are cut there; a new prompt part or tool field that can grow goes through the same limits, and `tests/test_budget.py` checks the biggest input stays under `LOCAL_INPUT_CHARS`.
- **Every agent run starts with a plan.** The planner model answers a `Plan` (`cause` + `steps`) before the local model acts, so a test's planner script starts with `plan(...)` (`tests/test_agent_loop.py`); `plan()` with no steps offers every gateway tool. The executor only gets the plan's tools, and a gateway rejection while executing raises `PlanBroken` (replan) instead of reaching the local model.
- **Agent tests drive models with `tests/scripted.py`.** A `Script` answers each model request in order (`call(tool, ...)`, `final(...)`, `fail(...)`) and keeps what it was sent, so a test can assert what reached the model. Never call a real LLM from a test.
- **The trace log (`trace ticket=<id>`, `ai_server/agent/trace.py`) never carries values.** specPatch values appear as a type only (`int`, `str`, `obj`), other tool args as names only, rejections as code plus `path:code` pairs (the gateway message can repeat a value), exceptions as class names. Model-made strings go through `trace.clean`. A new trace line goes through these helpers, and `tests/test_trace.py` asserts a secret-looking value never reaches `caplog`.
