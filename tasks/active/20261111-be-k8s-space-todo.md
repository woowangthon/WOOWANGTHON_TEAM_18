# BE: connect to the leader's k8s API and create the student space proj-<slug> (#81)

- **SRS**: none (W3 prerequisite; issue [#81](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/81), design [`docs/design/space.md`](../../docs/design/space.md))
- **Owner**: TaeTaeJin
- **Branch**: feat/be-k8s-space

## Plan

W3 (#43) puts Secrets into `proj-<slug>`, so the namespace must exist first. The platform server creates the space ([cluster.md](../../docs/design/cluster.md) §6, §8): Namespace, LimitRange, ResourceQuota, NetworkPolicy, and the read RoleBinding (five objects, the issue text says four; the infra owner's comment on the issue added the fifth), with the same values as `Infra/student/space.yaml`, only the name changes.

Stage 1 (this PR): everything that needs no real access. Connection settings (`K8S_API_URL`, `K8S_TOKEN`, `K8S_CA`; all empty = boots, cluster features answer 503), a client over `node:https` with the private CA, `SpaceService.ensureSpace(slug)`, errors as `503 CLUSTER_UNAVAILABLE`, tests against a fake k8s API. Stage 2 (a real leader and `Infra/student/check.sh`) waits for the infra owner's values.

No HTTP endpoint and no new library. No FE contract (nothing the browser calls).

## Todo

- [x] Design first — files: `docs/design/space.md`
- [x] Settings and boot rule — files: `BE/src/config/env.ts`, `env.spec.ts`, `BE/.env.example`
- [x] k8s client, space template, service, module — files: `BE/src/k8s/*`
- [x] Tests with a fake k8s API (http loopback and https with a private CA made by `openssl` at test time) — files: `BE/src/k8s/*.spec.ts`
- [x] `docs/ai-scope.md` (not verified against a real cluster), `cluster.md` pointer
- [ ] `pnpm verify`, hand mutants, `/code-review low`, `/simplify`

## Done when

- [ ] `pnpm verify` exit code 0 seen
- [ ] PR body says "실제 클러스터 미확인"
- [ ] tests added; mutation survivors resolved or explained
