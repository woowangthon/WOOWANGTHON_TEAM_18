# Cluster ADRs: registry (GHCR) and server link (Tailscale)

- **SRS**: none yet (infra decisions; SRS UC/FR still empty)
- **Owner**: 유성 (seren-wib)
- **Branch**: docs/cluster-adrs
- **Issue**: https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/14

## Plan

Record the two cluster decisions agreed on Discord on 2026-11-01 as ADRs. ADR-001 bundles the whole stack and names ECR, so the registry ADR replaces only that item: ADR-001 keeps its body and its status line becomes `유효 (일부 대체: 레지스트리 → 003)`. That status is added to the ADR rules by #19, which merges first. The ADR rules require the §3 component table to change in the same PR, and CLAUDE.md §1-3 requires ai-scope to follow any external technology change.

Out of scope: the volume ADR (after the PC spec check, plan stages 02 / 08′; it will also replace ADR-001's S3 item), the `physical-network.drawio.svg` link swap (#16), the per-project resource cap value (`docs/design/cluster.md`), the rest of §3 / §4 / §5 (#16).

## Todo

- [x] ADR-003 registry: public GHCR — files: `docs/adr/003-registry-ghcr.md`, ADR-001 status line, §3 registry and build rows, ai-scope
- [x] ADR-004 server ↔ leader over Tailscale — files: `docs/adr/004-server-cluster-link-tailscale.md`, §3 leader-agent row → private-network row, ai-scope
- [ ] Open the PR as draft after #19 is open; merge after #19

## Done when

- [ ] ADR-003 and ADR-004 are in `docs/adr/`, and ADR-001's status line points at ADR-003 for the registry only
- [ ] §3 registry and private-network rows and ai-scope say the same as the two ADRs
- [ ] merged after #19
