# BE project setup

- **SRS**: NFR-OPS-02 (widened to FE · BE; no FR — foundation work for the BE chosen in [ADR-001](../../docs/adr/001-stack-and-deployment.md))
- **Owner**: TaeTaeJin
- **Branch**: chore/be-setup

## Plan

Start `BE/` as a Nest project with the toolchain every later BE PR relies on: lint, typecheck, tests, build, a local container image and a CI workflow. No feature and no auth yet — login (id/pw via Supabase Auth, GitHub linked to the account later) is the next PRs and comes with its own ADR, because it changes ADR-001's GitHub-OAuth login.

Nest 12 is ESM-only and its default app template is ESM + Vitest, so the BE uses Vitest like the FE (decorator metadata reaches DI without an SWC plugin — checked). ESLint mirrors the FE config; the BE takes ESLint 10 because the FE's reason for 9 (`jsx-a11y`) does not apply. Template extras (oxlint, Prettier, `@nestjs/mau`) are left out.

The app has one route, `GET /api/health`, for container and ops checks — not an FE↔BE contract, so `docs/design/api.md` is untouched. Settings are `PORT` and `CORS_ORIGINS`, validated at boot (a bad value stops the server). Production CORS follows the system definition: the FE origin goes in the allowlist; locally the Vite proxy makes it same-origin, so the list stays empty. The mutation tool stays TBD ([`docs/conventions.md`](../../docs/conventions.md) §6).

## Todo

- [x] Scaffold: `package.json` (pnpm, engines from the lock), `tsconfig*.json`, `nest-cli.json`, ESLint, health route, e2e test — files: `BE/`
- [x] Env validation + CORS allowlist, `setupApp` shared by `main.ts` and e2e tests, `.env.example` — files: `BE/src/config/`, `BE/src/app.setup.ts`
- [x] Local container image — files: `BE/Dockerfile`, `BE/.dockerignore`
- [x] CI: install → lint → test → build on Node 22 — files: `.github/workflows/be.yml`
- [x] Docs — files: `CLAUDE.md` (Commands), `docs/conventions.md` §6, `docs/ai-scope.md` §1, `docs/SRS.md` (NFR-OPS-02, component names only)

## Done when

- [x] History is 6 commits by category (scaffold, env + CORS, Docker, CI, docs, task docs); each code commit passes `pnpm install --frozen-lockfile && pnpm verify` on its own
- [x] `docker build -t be BE` → container answers `GET /api/health`, runs as a non-root user, exits on a bad `PORT`
- [x] CI workflow runs green on GitHub — unlike #23, the fork PR (#26) ran both workflows; BE passed install → lint → test → build
- [ ] Notion SRS synced with the NFR-OPS-02 change — TaeTaeJin keeps Notion in step with the repo docs
- [x] tests added (env unit tests, e2e for health · prefix · CORS); mutation testing not run — no mutation tool chosen yet (conventions §6); a manual spot check of 10 hand-made mutants killed all of them
