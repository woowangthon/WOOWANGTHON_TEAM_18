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
