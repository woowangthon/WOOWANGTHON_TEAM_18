# Cluster diagram: merge ⑤ ⑥ into one tab from the build plan

- **SRS**: none yet (diagram only; SRS UC/FR still empty)
- **Owner**: 유성 (seren-wib)
- **Branch**: docs/cluster-diagram
- **Issue**: https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/11

## Plan

Tabs ⑤ (physical network) and ⑥ (cluster) from PR #8 describe the pre-plan design (club-room router LAN, leader-only egress, ECR, sticky local volumes + S3 copy, SQLite, 80% ceiling, tunnel from the leader, temp subdomain). The k3s build plan (artifact v67) replaced all of that, and the physical/logical split no longer helps: node IPs live on our switch, every node reaches the internet over Wi-Fi, inbound is Tailscale only, and which Pod sits on which node decides what survives a leader outage. One tab shows the failure story; two tabs force cross-reading. ⑤'s port table, checklist and commands are documentation, not drawing — they go to `docs/design/cluster.md` in a later PR.

Draw in layers and check each layer against a fact list extracted from the plan (premise table, stages 00–12, 3′ contract), so nothing from the plan is dropped. Reuse the legend and palette of tabs ①–④.

## Todo

- [x] Fact checklist from plan v67 — file: scratch `facts.txt`
- [x] Layer 1: zones (outside / club room / 3 PCs / switch) — file: `docs/architecture/cluster.drawio.svg`
- [x] Layer 2: outside boxes (operator machines, Tailscale, student GitHub, GHCR, AWS server·AI·Supabase, Cloudflare DNS·Tunnel·R2, visitor, external DB)
- [x] Layer 3: node contents (leader: k3s server·etcd, RBAC·VAP, GHCR cache, Prometheus·Grafana; workers: CoreDNS, Traefik, cloudflared, Longhorn, student-a DB app, student-b external-DB app, failover slot)
- [x] Layer 4: three networks per node (Wi-Fi, switch static IP, tailscale0)
- [x] Layer 5: numbered flows 1–9 + flow table
- [x] Layer 6: failure / secrets / priority text boxes, legend
- [x] Delete `docs/architecture/physical-network.drawio.svg`; drop the untracked `docs/k3s-cluster.drawio.svg`
- [x] Render PNG, stale-word check, checklist check
- [x] Slim the diagram to structure only after review loops 1–4 (plan v72); detail goes to docs/design/cluster.md at plan stage 04

## Done when

- [x] one file, one tab named "⑤ 클러스터"
- [x] every line of the fact checklist appears as a label
- [x] none of: 40%, 80%, 스티키, ECR, SQLite, 공용 MySQL, 임시 서브도메인, 공유기 LAN, 리더만 밖으로
- [ ] SVG renders on GitHub (draw.io re-export verified locally; GitHub render checked after push) and reopens in draw.io
