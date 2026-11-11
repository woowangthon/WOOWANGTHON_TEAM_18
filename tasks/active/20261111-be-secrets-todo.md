# BE: pass the student's secret values to the leader's k8s Secret (W3) and read the state (#43, #82)

- **SRS**: none (W3 of the deploy workflow; issues [#43](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/43), [#82](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/82), FE [#83](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/83))
- **Owner**: TaeTaeJin
- **Branch**: feat/be-secrets-api (stacked on feat/be-k8s-space, PR #106, which is #81). `feat/be-secrets` (on the fork only, no PR) keeps the first version that also had the k8s Secret code, as a reference for the cluster-call module (#111, seren-wib).

## Plan

W3: the server takes the values of `runtime.secretKeys` from the user and hands them to `SecretWriter.write(slug, service, values)`, which writes the Secret `<service>-secrets` in `proj-<slug>` over the connection of #81. The writer is an interface (`BE/src/deploys/secret-writer.ts`); `ClusterSecretWriter` (`BE/src/deploys/cluster-secret-writer.ts`) binds it to `SpaceService.ensureSpace` then `ClusterSecrets.write` (#118, merged). With no cluster settings the write answers `503 CLUSTER_UNAVAILABLE`. The server account can create and replace a Secret but not read or patch it, so **a send replaces a service's whole Secret**: the sent key set must equal the service's `secretKeys`, services may be sent separately, no per-key partial send. That is decided in the contract (`docs/design/api.md` "비밀값") and sent to FE (#83) before the code.

State: Supabase `deploy_secrets` (slug × service: key names, `writing` / `in`, HMAC-SHA256 of the key/value pairs under the server-only `SECRET_HASH_KEY`). Never the values. `writing` is recorded before the cluster call and `in` after it, so no failure leaves `in`. `ready` and `secretHash` are computed on read from those rows; the same GET serves the "build ready" read of #82. `PUT` / `GET /api/deploys/:id/secrets`, owner only.

#82 (own PR, on top of #43): `DeployReadinessService.prepareIfReady(deployId)` (calls `DeployConditionService.prepare` with the hash only when ready, else 409 `NOT_READY` with `fields`), agreed with the #44 worker. The user-facing "build ready" read is the GET above, no new endpoint.

## Todo

- [x] Contract first (`api.md`, `auth.md`) and send it to FE — files: `docs/design/api.md`, `docs/design/auth.md`
- [x] `SecretWriter` interface + `ClusterSecretWriter` adapter (`ensureSpace` first, then `ClusterSecrets.write` from #118; the k8s code is seren-wib's) — files: `BE/src/deploys/secret-writer.ts`, `cluster-secret-writer.ts`, `deploys.module.ts`
- [x] Validation, digests, status as pure functions — files: `BE/src/deploys/secrets-input.ts`
- [x] `SecretsService`, controller routes, store methods, migration — files: `BE/src/deploys/`, `supabase/migrations/20261111020000_create_deploy_secrets.sql`
- [x] Body-parse error message no longer repeated (it carries a piece of the body) — files: `BE/src/common/api-exception.filter.ts`
- [x] Tests: unit (validation, hashes with independently computed values, status), e2e through the app with a fake Supabase and a fake `SecretWriter`; checks that no value is in any response, log, database row or request to the database
- [x] Hand mutants (no BE mutation tool, #67): 29 mutants on the decision lines of this branch, 29 killed (the 41 of the first version also covered the k8s Secret code that is not in this branch)
- [x] `pnpm verify`, `/code-review low`, `/simplify`

## Done when

- [x] `pnpm verify` exit code 0 seen
- [x] PR body says "실제 클러스터 미확인". The migration `20261111020000_create_deploy_secrets.sql` was applied to the real Supabase on 2026-11-11 by the peer session (checked via PostgREST: the server key gets 200, the public key gets permission denied)
- [ ] tests added; mutation survivors resolved or explained
