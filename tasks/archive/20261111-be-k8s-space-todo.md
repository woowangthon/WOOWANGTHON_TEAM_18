# BE: connect to the leader's k8s API and create the student space proj-<slug> (#81)

- **SRS**: none (W3 prerequisite; issue [#81](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/81), design [`docs/design/space.md`](../../docs/design/space.md))
- **Owner**: TaeTaeJin
- **Branch**: feat/be-k8s-space

## Plan

W3 (#43) puts Secrets into `proj-<slug>`, so the namespace must exist first. The platform server creates the space ([cluster.md](../../docs/design/cluster.md) §6, §8): Namespace, LimitRange, ResourceQuota, NetworkPolicy, and the read RoleBinding (five objects, the issue text says four; the infra owner's comment on the issue added the fifth), with the same values as `Infra/student/space.yaml`, only the name changes.

Stage 1 (this PR): everything that needs no real access. Connection settings (`K8S_API_URL`, `K8S_TOKEN`, `K8S_CA_CERT`; all empty = boots, cluster features answer 503), a client over `node:https` with the private CA, `SpaceService.ensureSpace(slug)`, errors as `503 CLUSTER_UNAVAILABLE`, tests against a fake k8s API. Stage 2 (a real leader and `Infra/student/check.sh`) waits for the infra owner's values.

No HTTP endpoint and no new library. No FE contract (nothing the browser calls).

## Todo

- [x] Design first — files: `docs/design/space.md`
- [x] Settings and boot rule — files: `BE/src/config/env.ts`, `env.spec.ts`, `BE/.env.example`
- [x] k8s client, space template, service, module — files: `BE/src/k8s/*`
- [x] Tests with a fake k8s API (http loopback and https with a private CA made by `openssl` at test time) — files: `BE/src/k8s/*.spec.ts`
- [x] `docs/ai-scope.md` (not verified against a real cluster), `cluster.md` pointer
- [x] Hand mutants (no mutation tool for BE, #67): 42 mutants on the changed decision lines (status mapping, token header, CA and verification, IPv6 host, timeout, order, slug guard, template values, env rules), 42 killed. 5 of the first 39 survived (template compared one way only, log content, timeout, equivalent no-throw); fixed with tests, none left
- [x] `/code-review low`: one real finding (IPv6 host kept its brackets, fixed with a test); `/simplify` (4 angles): `create` returns void, one request call for http/https, env parsing without `!`, redundant template tests dropped, EC keys for the test CA. Skipped: keep-alive agent, injectable timeout, yaml parser dev-dependency, moving `SLUG`, a generic `request(method)` (each is #43/#82 work or costs a dependency)
- [x] `pnpm verify` exit code 0 (13 test files, 824 tests)

## Done when

- [x] `pnpm verify` exit code 0 seen
- [x] PR body says "실제 클러스터 미확인"
- [ ] tests added; mutation survivors resolved or explained
