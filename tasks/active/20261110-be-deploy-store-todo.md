# BE deploy input store: validate and save the confirmed spec + commit in Supabase

- **SRS**: none yet (W2–W3 of [ADR-010](../../docs/adr/010-repo-analysis-and-security-scan-in-platform-server.md); issue [#76](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/76), also the last item of [#41](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/41) and the decision in [#42](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/42)). SRS §2.4 has no row for it; adding one needs the matching Notion change first.
- **Owner**: TaeTaeJin
- **Branch**: feat/be-deploy-store (stacked on feat/be-commit-pin = PR #70, because saving needs `assertCommit`; rebase onto `upstream/main` with `--onto` once #70 is squash-merged)

## Plan

Why first: the FE needs a save/read contract to work in parallel, and W3 (Secret names come from the spec), W4 (build) and the leader (W5) all read the same confirmed input.

Decided with the owner (2026-11-10):
- **Write path**: the BE alone writes, with the Supabase secret key (service role); users only read their own rows (RLS). The server then guarantees "the commit that was checked is the commit in the saved spec" and that the spec passed validation. A user token + RLS write path would let a client skip both by calling Supabase directly.
- **Model**: one table `deploys`: one row = one confirmed deploy input (`id` is the `deployId`), immutable once saved (an edit saves a new row). `deploy_condition` (build hash, image digest) is created per run, so it is **not** stored here; it belongs to #44. No `projects` table yet.
- **Migrations**: SQL files in `supabase/migrations/`, applied by the owner (this agent has no access to the Supabase project).
- **First PR scope**: contract (`docs/design/api.md`) + validation + save/read API + migration SQL. Converting the draft (`deploy-spec`) into a spec stays with the FE form (users fill the cells the draft cannot know); a BE converter comes later if needed.

API: `POST /api/deploys` (`{ repoUrl, commit, spec }` → `201 { id, repo, commit, spec, createdAt }`) and `GET /api/deploys/:id` (owner only). Order of checks in `docs/design/api.md`.

Not decided by us, so not invented: the `resources` shape (only `null` is accepted for now) and the list of reserved `slug` names (a small initial list in code, to be confirmed by the infra owner).

## Todo

- [ ] Docs first: `docs/design/api.md` (contract), `auth.md` (server key, owner-only reads, order of checks), `docs/ai-scope.md` — files: `docs/`
- [ ] Review round R0 (agy `w4:p2`, BE group): gaps in the contract, hostile inputs
- [ ] Spec types + validation (pure functions, table tests) — files: `BE/src/deploys/deploy-input.ts`, `.spec.ts`
- [ ] Env `SUPABASE_SECRET_KEY` (required, validated at boot, never logged) — files: `BE/src/config/env.ts`, `BE/.env.example`, `BE/vitest.config.ts`
- [ ] Migration SQL + RLS (read own rows only; no write policy) — files: `supabase/migrations/`
- [ ] Save/read service and controller; e2e with a fake Supabase REST — files: `BE/src/deploys/`, `BE/test/deploys.e2e.spec.ts`
- [ ] Hand-made mutants for the new code; survivors get a test or a reason
- [ ] `pnpm verify`, `/code-review medium`, `/simplify`
- [ ] Owner applies the migration, sets `SUPABASE_SECRET_KEY`, and runs the real save/read once (until then the REST calls are unverified against real Supabase)

## Done when

- [ ] `POST /api/deploys` saves a validated spec for a repo the user owns, and `GET /api/deploys/:id` returns it only to its owner
- [ ] a real run against the owner's Supabase project works, or the PR body says that path is unverified
- [ ] tests added; mutation survivors resolved or explained
