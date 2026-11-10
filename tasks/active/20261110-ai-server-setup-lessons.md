# AI server setup — lessons

## Log

- 2026-11-10: Scaffolded with `uv init --app`. Settings use pydantic-settings with `env_ignore_empty`, so an empty line copied from `.env.example` means "unset" (default or "Field required"), the same as BE's `PORT=`.
- 2026-11-10: First boot-error draft passed pydantic's `ValidationError` through; its text includes `input_value=...`, which would print `AGENT_API_TOKEN`. Rebuilt the message from `loc` and `msg` and raised `from None`; a test asserts the token is absent and the chain is cut.
- 2026-11-10: Starlette's `TestClient` warns that `httpx` is deprecated and asks for `httpx2`; switched the dev dependency.
- 2026-11-10: `ghcr.io/astral-sh/uv` could not be pulled from the agent sandbox (GHCR blob host denied), so the Dockerfile installs uv with pip in the build stage. The local check build injected the sandbox proxy CA through a temporary Dockerfile in the scratchpad; the committed Dockerfile has no CA handling.
- 2026-11-10: Hand mutants: 17 run, 15 killed. Survivors: `min_length=1` on `HOST` (unreachable — empty means unset) and `docs_url=None` (FastAPI only serves `/docs` when `openapi_url` is set). Both deleted as dead code.

## Lessons

- Pydantic's validation message echoes the input. Any settings error that reaches a log must be rebuilt without `input` (now in [`AI/CLAUDE.md`](../../AI/CLAUDE.md) Pitfalls).
