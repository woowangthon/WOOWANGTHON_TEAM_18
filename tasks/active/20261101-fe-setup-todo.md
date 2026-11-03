# FE project setup

- **SRS**: NFR-SEC-02, NFR-OPS-02 (no FR; foundation work for the FE chosen in [ADR-001](../../docs/adr/001-stack-and-deployment.md))
- **Owner**: TaeTaeJin
- **Branch**: chore/fe-setup

## Plan

Start `FE/` as a Vite + React + TypeScript project with the toolchain every later FE PR relies on: lint, typecheck, Vitest, build, and a CI workflow. ADR-001 fixed React + TypeScript but left the test tool and CI open, so this PR picks them: Vitest (same config as Vite, no second transformer) with `@testing-library/react` on jsdom. The mutation tool stays TBD ([`docs/conventions.md`](../../docs/conventions.md) §6) — choosing one is a separate decision and no FE logic exists yet to mutate.

The template demo (counter, `App.css`, `assets/`) is removed; `App` renders nothing. No router, no styling — the design system is the next PR, stacked on this one.

CI runs on every PR (a docs-only PR must not hang if it is made a required check later) and on pushes to `main` that touch `FE/**` or the workflow itself. It is not a required status check yet, so it cannot block the ruleset.

## Todo

- [x] Remove `FE/.gitkeep`, scaffold with `npm create vite@latest FE -- --template react-ts`, strip the demo — files: `FE/`
- [x] Scripts `dev`, `build`, `lint`, `typecheck`, `test` — files: `FE/package.json`
- [x] Vitest + Testing Library + jsdom, one smoke test that renders `App` — files: `FE/vite.config.ts`, `FE/src/App.test.tsx`
- [x] CI: `pnpm install --frozen-lockfile` → lint → test → build on Node 22 (`build` runs `tsc -b`, so there is no separate typecheck step) — files: `.github/workflows/fe.yml`
- [x] Docs in the same PR — files: `CLAUDE.md` (Commands), `docs/conventions.md` §6, `docs/ai-scope.md` §1, `.gitignore`
- [x] SRS: FE responsibility, deploy row, NFR-SEC-02, NFR-OPS-02, written with component names only (system-definition §7) — files: `docs/SRS.md`

## Done when

- [x] History is 8 commits by category (`.gitignore`, scaffold, ESLint, Vitest, CI, docs, SRS, task docs); each code commit passes on its own
- [x] `cd FE && pnpm install --frozen-lockfile && pnpm verify` passes
- [x] `pnpm dev` serves an empty page without console errors
- [ ] CI workflow runs green on GitHub — never executed yet; the first run is the draft PR
- [x] tests added (smoke test); mutation testing not run — no mutation tool chosen yet (conventions §6), noted in the PR body
