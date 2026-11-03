# Cluster ADRs: registry, server link, k3s cluster, metrics

- **SRS**: none yet (infra decisions; SRS UC/FR still empty)
- **Owner**: 유성 (seren-wib)
- **Branch**: docs/cluster-adrs
- **Issue**: https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/14

## Plan

Record the cluster decisions that are already made and expensive to reverse as ADRs, one decision per file (#19): registry and server link (Discord 2026-11-01), the k3s cluster layout (10/29 meeting + infra owner) and metrics storage (Discord 2026-11-01). ADR-001 bundles the whole stack and names ECR, so the registry ADR replaces only that item: ADR-001 keeps its body and its status line becomes `유효 (일부 대체: 레지스트리 → 003)`. That status is added to the ADR rules by #19, which merges first. The ADR rules require the §3 component table to change in the same PR, and CLAUDE.md §1-3 requires ai-scope to follow any external technology change.

Out of scope: the volume ADR (after the PC spec check, plan stages 02 / 08′; it will also replace ADR-001's S3 item), the `physical-network.drawio.svg` link swap (#16), the per-project resource cap value (`docs/design/cluster.md`), the rest of §3 / §4 / §5 (#16). §6 drops the items these ADRs settle here, because §6 itself says decided items leave the table.

## Todo

- [x] ADR-003 registry: public GHCR — files: `docs/adr/003-registry-ghcr.md`, ADR-001 status line, §3 registry and build rows, ai-scope
- [x] ADR-004 server ↔ leader over Tailscale — files: `docs/adr/004-server-cluster-link-tailscale.md`, §3 leader-agent row → private-network row, ai-scope
- [x] ADR-005 k3s cluster on the three school PCs — files: `docs/adr/005-k3s-cluster-on-school-pcs.md`, §3 k3s row
- [x] ADR-006 metrics in the leader Prometheus, no time-series DB — files: `docs/adr/006-metrics-on-leader-prometheus.md`, §3 metrics and log-store rows, platform server row, ai-scope
- [x] Open the PR as draft (#21); merge after #20
- [x] Review fixes: SRS §1.6 says the three lent PCs run 24 hours; ADR-005 leaves worker-side public entry to the public-entry decision; ADR-003 adds the first-push visibility step; §6 drops the time-series DB, Grafana hosting and ECR items

## Done when

- [x] ADR-003 to ADR-006 are in `docs/adr/`, and ADR-001's status line points at ADR-003 for the registry only
- [x] §3 rows (build, registry, k3s, private network, metrics, log store), §6, SRS §1.6 and ai-scope say the same as the ADRs
- [ ] merged after #20 (#19)
