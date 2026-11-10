# BE commit pin: `repos/check` returns the commit, `deploy-spec` reads it

- **SRS**: none yet (W0 of [ADR-010](../../docs/adr/010-repo-analysis-and-security-scan-in-platform-server.md); issues [#41](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/41) and [#60](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/60)). SRS §2.4 has no row for it; adding one needs the matching Notion change first, so it is left for the maintainer.
- **Owner**: TaeTaeJin
- **Branch**: feat/be-commit-pin (from `upstream/main`; #48 and #59 are already in it)

## Plan

At intake, `POST /api/repos/check` also returns `commit`: the full SHA of the default branch's HEAD, read after the ownership check passed. The FE keeps it and passes it to later steps. `POST /api/repos/deploy-spec` takes an optional `commit` and reads the file list and each `package.json` at that commit instead of `HEAD`, and echoes it in the response so the confirmed spec can carry it.

Decided with the owner: the commit goes in the `check` response; the confirmed spec will be stored in Supabase, but **storing it is a later task** (table, migration, save API, user token + RLS vs service key, project/round model). `repos/dockerfiles` is not changed (its response shape is on hold, #46). `.env` warning moved to #45.

Not done here on purpose: the server does not remember the commit, so "the commit that was scanned equals the commit in the saved spec" cannot be checked yet. It belongs to the save task. A client-supplied `commit` only drives a read-only draft of a public repo.

## Todo

- [x] Probe real GitHub answers (HEAD SHA, tree by SHA, missing/short/tree SHA, raw by SHA, rate use)
- [x] Docs first: `docs/design/api.md`, `auth.md`, `docs/ai-scope.md` — files: `docs/`
- [x] Review round R0 (agy, Gemini): gaps in the docs, hostile `commit` inputs
- [x] `commit` check (pure function) + `check()` returns the commit + `deploySpec(…, commit?)` + e2e — files: `BE/src/repos/`, `BE/test/repos.e2e.spec.ts`
- [x] Review rounds R2a (agy, GPT-OSS 120B: correctness / security) and R2b (agy, Gemini: docs vs code)
- [x] Follow-ups from the #48 review: tick `20261109-be-deploy-spec-draft-todo.md` truthfully, rerun the hand-made mutants after the refactor, fix the GitHub limit wording
- [x] Hand-made mutants for the new code; survivors get a test or a reason
- [ ] `pnpm verify` (passes with `--testTimeout=30000`; the health test times out at 5 s on this machine, also on `upstream/main`), `/code-review medium`, `/simplify` (done), R3 (agy, GPT-OSS 120B; running)
- [ ] Commit locally. Do **not** push (the owner pushes later; FE login work may conflict)
- [ ] Next task: #45 (security scan, now also warns about a committed `.env`)
- [ ] Later task: store the confirmed spec in Supabase (needs a data model in `docs/design/` first)

## Done when

(CI green is left for the PR checks to show.)

- [ ] `pnpm verify` passes on the final tree (all 383 pass; the unrelated health test is over its 5 s limit on this machine, see lessons)
- [x] The test fixtures have the shape of the real GitHub answers probed above
- [x] Hand-made mutants listed in lessons, survivors resolved or explained; the mutants from the #48 work are rerun on the refactored code
- [x] `/code-review medium` and `/simplify` were run and their findings handled
- [ ] Real Supabase + linked test account run, or the PR body says that path is unverified
