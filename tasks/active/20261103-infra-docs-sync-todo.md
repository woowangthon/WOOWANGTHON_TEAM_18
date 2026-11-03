# Infra docs sync: system definition and ai-scope follow the build plan

- **SRS**: none (structure docs; SRS UC/FR still empty)
- **Owner**: 유성 (seren-wib)
- **Branch**: docs/infra-docs-sync
- **Issues**: https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/16, https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/18

## Plan

`docs/system-definition.md` and `docs/ai-scope.md` still describe the PR 8 cluster design (leader agent + WebSocket, ECR + leader mirror, sticky local volumes + S3 copies, DB dumps through the server, 80% ceiling, remote_write, temporary subdomains, idle lab PCs, router LAN, SQLite). Rewrite the infra parts to match the build plan and the 2026-11-01 Discord agreements, following the §7 rule: technology only in the §3 table, §4 names components only, mechanism in §5. One PR for both issues (유성, 2026-11-03), branched from #21 and merged after it.

Decisions applied here (유성, 2026-11-03): the public entry stays on the leader for now; moving the tunnel client to the workers and the workers' backups to off-cluster storage are 후순위 (after the 3rd-priority items in the build plan). Leader-side outbound links keep their priority.

Not decided yet, written as such: student volume method (PC spec, volume ADR), OS install path, log storage (proposal pending), domain scope. On-site checks happen 2026-11-04; §5 values from them land in a follow-up commit or PR.

Out of scope: the five flow diagrams (#17); `cluster.drawio.svg` still draws worker tunnel connectors and backup priorities (follow-up with #17); SRS terms that still say replica / volume copy (SRS sync PR); `docs/design/cluster.md`.

## Todo

- [x] §3: remaining infra rows (object storage, student volume, outbound tunnel), terms, Kafka scope, leader migration plan; ai-scope rows for the same technologies — files: `docs/system-definition.md`, `docs/ai-scope.md`
- [x] §4: mechanism sentences → §3 component names — files: `docs/system-definition.md`
- [x] §5: physical / network and cluster layout per the build plan; §5.1 points at `cluster.drawio.svg`; delete `physical-network.drawio.svg` — files: `docs/system-definition.md`, `docs/architecture/physical-network.drawio.svg`
- [x] §6 infra items and ai-scope §5 limits — files: `docs/system-definition.md`, `docs/ai-scope.md`

## Done when

- [x] `docs/system-definition.md` has none of: 에이전트, WebSocket (except the deferred option), ECR, 스티키, 덤프 복원, 80%, remote_write, 임시 서브도메인, 유휴 PC, 공유기 LAN, SQLite
- [x] §4 names components only; infra mechanism is in §5
- [x] §3, §5, ADR-003–006 and ai-scope say the same thing
- [ ] merged after #21
