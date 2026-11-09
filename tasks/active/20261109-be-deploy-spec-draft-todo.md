# BE deploy spec draft API

- **SRS**: none yet (W1·W2 of [ADR-010](../../docs/adr/010-repo-analysis-and-security-scan-in-platform-server.md); issue [#42](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/42)). SRS §2.4 has no row for it; adding one needs the matching Notion change first, so it is left for the maintainer.
- **Owner**: TaeTaeJin
- **Branch**: feat/be-deploy-spec-draft (started on top of `feat/be-dockerfile-check`, PR #47; #47 was squash-merged meanwhile, so this is based on `upstream/main`)

## Plan

`POST /api/repos/deploy-spec` fills a **draft** deploy spec from `package.json` and lockfile names: framework, language, package manager, install / build / start command, output folder, port, plus the Dockerfile fact from the same file list (#25). Rule code only: no README, no LLM, student code is read, never run. The student reviews and confirms or edits it on the web. Same ownership check as `repos/dockerfiles` first, then one `git/trees/HEAD?recursive=1`, then each chosen `package.json` (max 10, shallowest first) through `raw.githubusercontent.com` in parallel, so the 60/h API limit is not spent per file (probed 2026-11-09: no rate-limit headers, `core` stays 60/60).

Scope decisions with the owner: this PR is **detection + draft read API, no DB**. The draft is a pure function of the repo, so it is recomputed, not stored. The API that saves the confirmed spec is left out: there is no table, no submission/round record and no pinned commit yet (open question 12 in the system definition, #41). Where to store it is only *proposed* in the PR body, from who reads and writes the spec and when (dashboard wireframe, PR #32 workflow). Still undecided and left alone: env keys (#43), what to do when there is no Dockerfile (#25, #44), fork policy, final response shape (#46), commit pinning (#41).

Defaults I chose where the owner's answer did not say (revisit in review): no lockfile → package manager from `packageManager` else `npm` (source `default`), install `<pm> install`; `bun.lockb` counts as bun; no library list in the response; HEAD, not a pinned commit; commands come only from `scripts` (no invented framework commands), the framework table only gives output folder and port.

## Todo

- [x] Probe real answers first: `package.json` samples (Vite template, Next example), a big recursive tree (317 `package.json`, 22 under `node_modules/`, nested lockfiles), raw `404`, rate limit
- [x] Docs first: `docs/design/api.md`, `auth.md`, `docs/ai-scope.md` — files: `docs/`
- [x] Review round R0 (agy): gaps in the rules, before code
- [x] Rules + table unit tests — files: `BE/src/repos/deploy-spec.ts`, `deploy-spec.spec.ts`
- [x] Review round R1 (agy): adversarial inputs → more test rows
- [x] Service `deploySpec()` + route + e2e (fake raw answers) — files: `BE/src/repos/repos.service.ts`, `repos.controller.ts`, `BE/test/repos.e2e.spec.ts`
- [x] Hand-made mutants; survivors get a test or a reason in the PR body
- [x] Review rounds R2 (agy), `/simplify`; `/code-review medium` and R3 (docs ↔ code) run before the final push
- [x] Spec-consumer table and storage proposal (R4), written into the PR body
- [ ] `pnpm verify`, rebase, push, open the **draft** PR
- [ ] FE: show the draft on the confirm screen (separate task; the wireframe's F3 screen still cites the README)
- [ ] Next PR: the API that saves the confirmed spec, after the project / round data model is drawn in `docs/design/`

## Done when

(CI green is left for the PR checks to show.)

- [x] `pnpm verify` passes on the final tree (311 tests)
- [ ] The test fixtures have the shape of the real GitHub / raw answers probed above
- [ ] Real Supabase + linked test account run on one of the owner's own public personal repos (throwaway local page, not committed), or the PR body says that path is unverified
- [ ] Tests added; mutation testing not run with a tool (none chosen yet, conventions §6); hand-made mutants listed in lessons, survivors resolved or explained
- [ ] A draft PR is open with: stacked-on-#47 note, undecided items, defaults above, known limits, storage proposal
