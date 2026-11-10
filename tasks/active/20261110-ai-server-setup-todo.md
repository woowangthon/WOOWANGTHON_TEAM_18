# AI server setup

- **SRS**: none yet — the deploy-failure agent is "FR 미정" in [`docs/ai-scope.md`](../../docs/ai-scope.md) §2; foundation work for the AI server chosen in [ADR-001](../../docs/adr/001-stack-and-deployment.md) and [ADR-012](../../docs/adr/012-agent-acts-through-platform-gateway.md)
- **Owner**: 김현식 (track B)
- **Branch**: feat/ai-server-setup

## Plan

Start `AI/` as a Python 3.12 FastAPI app with the toolchain every later AI PR relies on, the way `BE/` started (chore/be-setup): uv for Python, dependencies and the lock file, ruff for lint and format, mypy strict, pytest, a container image and a CI workflow. No agent yet — the ticket API (F10) and the agent loop (F12) are the next PRs.

One route, `GET /health`, for container and ops checks; it is not part of the platform ↔ AI contract, so `docs/design/api.md` is untouched. Settings are read with pydantic-settings: `HOST` (default `127.0.0.1`, the image sets `0.0.0.0`), `PORT` (default 8000), and the two values the contract fixes for the AI server, `AGENT_API_TOKEN` (32+ chars) and `GATEWAY_URL` (http/https). A bad value stops the server at boot. Pydantic's own error text repeats the input, so the boot error is rebuilt from the variable name and reason only — the token never reaches a log. Model settings come with the agent (F12), where they are used.

The image installs uv from PyPI in the build stage (not `ghcr.io/astral-sh/uv`) and ships only the runtime venv, run as a non-root user. CI mirrors `be.yml`: actions pinned by SHA, install → lint → format check → mypy → pytest. The mutation tool stays TBD; hand-made mutants are used as the conventions allow.

## Todo

- [x] Scaffold: `pyproject.toml` (ruff, mypy, pytest config), `.python-version`, `uv.lock`, `ai_server/` (`create_app`, `/health`, `python -m ai_server`), tests — files: `AI/`
- [x] Settings validation that stops boot without printing values, `.env.example` — files: `AI/ai_server/config.py`, `AI/tests/test_config.py`
- [x] Container image — files: `AI/Dockerfile`, `AI/.dockerignore`
- [x] CI — files: `.github/workflows/ai.yml`
- [x] Docs — files: `AI/CLAUDE.md`, `CLAUDE.md` (routing, Commands), `CONTRIBUTING.md` (stack file list), `docs/conventions.md` §6, `docs/ai-scope.md` §1, `.gitignore`

## Done when

- [x] `uv sync --locked` then ruff check, ruff format --check, mypy, pytest all pass
- [x] `python -m ai_server` exits 1 with only variable names when settings are missing or bad; answers `GET /health` with `{"status":"ok"}` when they are set
- [x] `docker build -t ai AI` → container answers `GET /health`, runs as uid 10001, has no dev dependencies, exits on missing settings
- [ ] CI workflow runs green on GitHub
- [x] tests added; mutation testing by hand (17 mutants; the 2 survivors were dead code and were deleted)
