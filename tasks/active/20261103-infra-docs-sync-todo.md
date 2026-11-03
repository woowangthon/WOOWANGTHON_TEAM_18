# Infra docs sync: system definition and ai-scope follow the build plan

- **SRS**: none (structure docs; SRS UC/FR still empty)
- **Owner**: 유성 (seren-wib)
- **Branch**: docs/infra-docs-sync
- **Issues**: https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/16, https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/18, https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/17

## Plan

`docs/system-definition.md` and `docs/ai-scope.md` still describe the PR 8 cluster design (leader agent + WebSocket, ECR + leader mirror, sticky local volumes + S3 copies, DB dumps through the server, 80% ceiling, remote_write, temporary subdomains, idle lab PCs, router LAN, SQLite). Rewrite the infra parts to match the build plan and the 2026-11-01 Discord agreements, following the §7 rule: technology only in the §3 table, §4 names components only, mechanism in §5. One PR for both issues (유성, 2026-11-03), branched from #21 and merged after it.

Decisions applied here (유성, 2026-11-03): the public entry stays on the leader for now; moving the tunnel client to the workers and the workers' backups to off-cluster storage are 후순위 (after the 3rd-priority items in the build plan). Leader-side outbound links keep their priority.

Planned, waiting for the PC spec: the student-volume tier (Longhorn 2 copies / 1 copy / local-path by worker memory, agreed with 태진; the volume ADR records the pick). Not decided yet, written as such: OS install path, log storage (proposal pending), domain scope. On-site checks happen 2026-11-04; §5 values from them land in a follow-up commit or PR.

Diagrams (#17) joined this PR after #21 merged (유성: a change and the files it affects go in one PR). Out of scope: `docs/design/cluster.md`.

## Todo

- [x] §3: remaining infra rows (object storage, student volume, outbound tunnel), terms, Kafka scope, leader migration plan; ai-scope rows for the same technologies — files: `docs/system-definition.md`, `docs/ai-scope.md`
- [x] §4: mechanism sentences → §3 component names — files: `docs/system-definition.md`
- [x] §5: physical / network and cluster layout per the build plan; §5.1 points at `cluster.drawio.svg`; delete `physical-network.drawio.svg` — files: `docs/system-definition.md`, `docs/architecture/physical-network.drawio.svg`
- [x] SRS §1.3 / §1.5 / §1.6 / §1.7: failover re-schedules one copy (no standby replica), volume copies live on the other worker, no off-cluster copy; slot term in §3 matches — files: `docs/SRS.md`, `docs/system-definition.md`
- [x] Diagrams: the five flow diagrams and `cluster.drawio.svg` use §3 component names; removed boxes (time-series DB, DB backup job, Grafana boxes) and their arrows; off-cluster backup drawn dashed (후순위); leader-side tunnel client added, worker tunnel connectors dashed. Edited the embedded XML by script and re-exported with the draw.io CLI (`--embed-diagram`) — files: `docs/architecture/*.drawio.svg`
- [x] Ingress runs on the workers (build plan): §5.2 node table and SRS §1.7 terms — files: `docs/system-definition.md`, `docs/SRS.md`
- [x] §6 infra items and ai-scope §5 limits — files: `docs/system-definition.md`, `docs/ai-scope.md`

## Done when

- [x] `docs/system-definition.md` has none of: 에이전트, WebSocket (except the deferred option), ECR, 스티키, 덤프 복원, 80%, remote_write, 임시 서브도메인, 유휴 PC, 공유기 LAN, SQLite
- [x] §4 names components only; infra mechanism is in §5
- [x] §3, §5, ADR-003–006 and ai-scope say the same thing
- [ ] merged after #21
