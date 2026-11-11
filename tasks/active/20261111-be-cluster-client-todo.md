# BE: cluster client module — Secret write, reads, error kinds (#111)

- **SRS**: none (in-server functions for W3 #43 and the admin API #100; issue [#111](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/111), design [`docs/design/cluster-client.md`](../../docs/design/cluster-client.md))
- **Owner**: seren-wib
- **Branch**: feat/be-cluster-client (cut from PR #106, rebased on `upstream/main` after #106 merged)

## Plan

PR #106 gives the connection, `K8sClient.create()` (POST only, every failure is one 503) and `ensureSpace`. This task adds what the next callers need, inside the rights of `platform/platform-server` ([cluster.md](../../docs/design/cluster.md) §8):

- `request(method, …)` on a keep-alive agent; `create()` now tells `created` from `exists`.
- `ClusterError` (extends the 503 exception, so an uncaught one is still `503 CLUSTER_UNAVAILABLE`) with a `kind` per status.
- `ClusterSecrets.write`: POST, on 409 PUT the whole object. No PATCH (the account lacks it on purpose).
- `ClusterReader`: pods, logs, deployments, nodes, trimmed to the fields #98 / #100 list.

No HTTP endpoint, no DB, no new library, no FE contract. Actions (scale / restart) and watch wait for the infra rights (build stage 09 part 2).

## Todo

- [x] Design first — files: `docs/design/cluster-client.md`
- [x] Client: `request`, keep-alive agent, `ClusterError` — files: `BE/src/k8s/k8s.client.ts`, `cluster-error.ts`, `k8s.client.spec.ts`
- [x] Shared fake k8s API (moved out of #106's spec, answers per method, text bodies) — files: `BE/test/fake-k8s.ts`, `BE/src/k8s/space.service.spec.ts`
- [x] Secret write — files: `BE/src/k8s/cluster-secrets.ts`, `cluster-secrets.spec.ts`, `BE/src/deploys/deploy-input.ts` (export `SERVICE_NAME`)
- [x] Reads — files: `BE/src/k8s/cluster-reader.ts`, `cluster-reader.spec.ts`
- [x] Hand mutants on the changed decision lines (no mutation tool for BE, #67): 68 mutants (status → kind mapping, 2xx bounds, created/exists, log content, token header, keep-alive, POST → PUT, Secret name · type · base64, slug · service · pod · container guards, tail limits, pod · deployment · node fields), 64 killed at first. The 4 survivors (status 300, `AlreadyExists` on a non-409, `available` read from `ready`, non-string label values) each got a test; none left
- [x] Real leader check in a throwaway space, then delete it (2026-11-11, result table in the design doc)
- [x] `docs/ai-scope.md` (verified on the real leader from the operator device; from EC2 not verified)
- [x] `/code-review medium` on the branch: 8 findings, 6 fixed (silent 503 on a 200 that is not a list, log size vs the 5 s limit → 256 KiB, init container waiting reason, scheme decided once, the 199 table row, pointer from `space.md`). 2 left as known limits in the design doc (403 / 404 a caller expects are still logged as errors; a 422 log has no rule name). `/simplify` not run
- [x] PR after #106 merges (rebase on `upstream/main`)

## Done when

- [x] `pnpm verify` exit code 0 seen in `BE/` (16 test files, 896 tests)
- [x] Real-leader result written in the design doc and the PR body
- [x] tests added; mutation survivors resolved or explained
