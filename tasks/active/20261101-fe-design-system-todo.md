# FE design system (tokens + base components)

- **SRS**: NFR-USA-01–03, NFR-PER-02 (no FR; foundation work)
- **Owner**: TaeTaeJin
- **Branch**: feat/fe-design-system

## Plan

Stacked on `chore/fe-setup`. Give the FE one visual language before screens exist: black-and-white, dense, minimal (Vercel-like), with Korean and English mixed in the same line (`nginx:1.27`, `Running 2/3`). Design details and rejected options: [`docs/design/design-system.md`](../../docs/design/design-system.md).

Why now, before the P0 demo path is finished: this is foundation, not a P1 feature. Scope is capped to keep it clear of F-2 ([`docs/conventions.md`](../../docs/conventions.md)) — only the six components the style guide uses (`Button`, `Input`, `Badge`, `Table`, `Card`, `LogBlock`), variants as plain TS object maps, no variants library, no router, no dark-mode toggle (follows `prefers-color-scheme`).

Styling is Tailwind CSS v4 with tokens declared in `@theme`; the default palette is emptied so only black / white / grays and four status colors exist. No ready-made component kit (shadcn/ui etc.).

The style guide page (`FE/src/styleguide/`) was temporary: it was the only screen of the app. Decision 2026-11-03: take screenshots first (attached to the PR), then delete it in this PR instead of a follow-up issue; components and tokens stay. `App` renders nothing until the first real screen.

## Todo

- [x] Write `docs/design/design-system.md` before implementing — files: `docs/design/design-system.md`
- [x] Install Tailwind v4 (`tailwindcss`, `@tailwindcss/vite`) and register the plugin — files: `FE/package.json`, `FE/vite.config.ts`
- [x] Tokens, fonts, base styles — files: `FE/src/styles/{fonts,theme,base}.css`, `FE/index.html`
- [x] Six base components — files: `FE/src/components/ui/`
- [x] Temporary style guide page, wired as the only screen — files: `FE/src/styleguide/StyleGuide.tsx`, `FE/src/App.tsx`
- [x] Tests: token consistency, component variants render, style guide renders — files: `FE/src/**/*.test.ts(x)`
- [x] `docs/ai-scope.md` §1 (Tailwind CSS), §3 (`SAMPLE` rows for the style guide data) and §4 (Nanum fonts: source, license, where used) — files: `docs/ai-scope.md`

## Done when

- [x] `cd FE && pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build` passes
- [x] Built CSS contains no default-palette classes (`bg-indigo-500` is not generated)
- [x] Light and dark text/background pairs reach WCAG AA (4.5:1), checked by script
- [x] Fonts load from the CDN (`document.fonts`) and the console has no errors
- [x] Screenshots (light, dark, Korean/English mixed table) taken and kept outside the repo
- [x] No component beyond the six listed
- [x] tests added; mutation testing not run — no mutation tool chosen yet (conventions §6), noted in the PR body

## Follow-up: design review fixes

- [x] Korean line breaking and no-wrap table cells / badges — files: `FE/src/styles/base.css`, `FE/src/components/ui/{Table,Badge}.tsx`
- [x] Numeric cells in a fixed-width font; table hugs its content — files: `FE/src/components/ui/Table.tsx`
- [x] `Input` requires an accessible name by type — files: `FE/src/components/ui/Input.tsx`
- [x] `LogBlock` colors level words — files: `FE/src/components/ui/LogBlock.tsx`
- [x] Non-blocking Google Fonts stylesheet (700 preload tried and reverted) — files: `FE/index.html`
- [x] Lint catches token-less classes; `docs/ai-scope.md` §1 row added — files: `FE/eslint.config.js`, `FE/package.json`, `docs/ai-scope.md`
- [x] CI: PRs always run, cancel only on PRs, timeout, no duplicate typecheck; `@types/node` 22 — files: `.github/workflows/fe.yml`, `FE/package.json`
- [x] Tests for the above — files: `FE/src/components/ui/ui.test.tsx`
- [ ] Not done: `npm audit fix` / `pnpm audit --fix` (needs `--force`), `TBody`/`Tr` wrappers, decisions that reverse the design doc — reasons in the lessons file

## Follow-up: second design review (P2 fixes)

Review findings P2 #2–#7 (the Vite default favicon, P1 #1, stays until there is a real icon; P3 left alone).

- [x] Disabled Button / Input drawn with tokens instead of `opacity-40` — files: `FE/src/components/ui/{Button,Input}.tsx`
- [x] `surface` made a visible step (light `#f4f4f4`, dark `#141414`) — files: `FE/src/styles/theme.css`
- [x] Table header, `LogBlock` and table mono cells at 13px; `Badge` stays 12px — files: `FE/src/components/ui/{Table,LogBlock}.tsx`, `FE/src/styleguide/StyleGuide.tsx`
- [x] Lint also rejects arbitrary values, unloaded font weights and shadow classes (`no-restricted-classes`) — files: `FE/eslint.config.js`
- [x] `className` is for spacing/layout only, written as a rule instead of adding `cn()` — files: `docs/design/design-system.md`
- [x] Contrast and `surface` step checked in tests; disabled and 13px classes asserted — files: `FE/src/styles/theme.test.ts`, `FE/src/components/ui/ui.test.tsx`
- [x] `FE/Dockerfile` (node build → nginx), `FE/nginx.conf`, `FE/.dockerignore`; `CLAUDE.md` command row and `docs/ai-scope.md` §1 row — files: `FE/`, `CLAUDE.md`, `docs/ai-scope.md`
- [x] Image build and nginx behavior checked on 2026-11-03 (see lessons Log) — files: `FE/Dockerfile`, `FE/nginx.conf`
- [ ] Not done: root `docker-compose.yml` waits until BE or AI has an image; CI does not build the image

Pre-commit cleanup (2026-11-03).

- [x] Screenshots of the style guide (light / dark x 1440 / 390px) saved to the Desktop folder `WOOWANGTHON-screenshots/design-system/` for the PR — files: none in the repo
- [x] Style guide page, its test and its two `SAMPLE` rows in `docs/ai-scope.md` §3 deleted; `App` returns `null` — files: `FE/src/styleguide/` (removed), `FE/src/App.tsx`, `docs/ai-scope.md`, `docs/design/design-system.md`, `docs/conventions.md`
