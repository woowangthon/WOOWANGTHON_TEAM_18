# k3s cluster build on the three school PCs

- **SRS**: no FR yet (infra; SRS FR table still empty) — serves NFR-OPS-01 (student URLs reachable until judging ends) and NFR-SEC-01 (no secrets in the repo)
- **Owner**: 유성 (seren-wib)
- **Branch**: docs/cluster-design (first PR: `docs/design/cluster.md` + this task pair); cluster code later goes under `Infra/` on its own branches
- **Issue**: https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/30
- **Decisions**: [ADR-003](../../docs/adr/003-registry-ghcr.md) registry, [ADR-004](../../docs/adr/004-server-cluster-link-tailscale.md) server link, [ADR-005](../../docs/adr/005-k3s-cluster-on-school-pcs.md) cluster, [ADR-006](../../docs/adr/006-metrics-on-leader-prometheus.md) metrics, [ADR-008](../../docs/adr/008-node-network-on-school-wired-lan.md) node network

## Plan

Build a leader + 2 worker k3s cluster on the three lent school PCs, stage by stage, each stage gated by a "done when" check. The detailed stage plan (premises, trade-offs, commands per stage) is kept outside the repo by the infra owner; this file tracks the stages and the repo-side deliverables. Everything after stage 01 is done remotely over Tailscale SSH with key login and passwordless sudo.

Rules for remote changes that can cut access (network, sshd, firewall): one PC at a time, w2 → w1 → leader, and arm an automatic revert first (`systemd-run --on-active=150 <undo>`), apply, reconnect from outside, then cancel the revert timer.

Priorities: the demo path first. Deferred (후순위): moving cloudflared from the leader to both workers, Longhorn backups and etcd snapshots to R2, Ansible playbooks. The AI teammate's v14 deploy redesign (GPU + vLLM on the leader, GoCD Agent, maybe in-cluster build, maybe external student DB) is not decided; if adopted it is done after stage 11 as a separate add-on.

## Todo

- [x] 00 Application form and PCs — PCs received 2026-11-03, OS on the internal NVMe survives reboot
- [x] 01 Remote access — disk images of all three, wall-port uplink through our switch, Tailscale, SSH keys from two devices, passwordless sudo, sleep off, BIOS power-on after AC loss, unattended reboot (2026-11-05)
- [x] 02 Site check — specs, address-range overlap (none), time sync, Tailscale path (DERP relay), no ufw installed, outbound TCP 7844 open on all three (2026-11-06)
- [x] 03 Common setup — hostnames `k3s-leader` / `k3s-w1` / `k3s-w2`, cloud-init `preserve_hostname: true`, timezone Asia/Seoul, unattended reboot check (2026-11-06)
- [x] 04 Node network and firewall (2026-11-06)
  - [x] node addresses `192.168.77.11` / `.12` / `.13` as a second address on `enp4s0` (`/etc/netplan/60-wanggane-node.yaml`), default route unchanged
  - [x] nodes reach each other on the node network; iperf3 ~941 Mbit/s on every pair, 0 retransmits
  - [x] `/etc/hosts` lists the three nodes
  - [x] SSH keys only (`/etc/ssh/sshd_config.d/10-wanggane-keys-only.conf`)
  - [x] ufw: deny incoming; allow in on `tailscale0` and from `192.168.77.0/24`, `10.42.0.0/16`, `10.43.0.0/16`
  - [x] ufw: deny outgoing; allow out to the same networks plus 53, 123/udp, 80/tcp, 443/tcp, 41641/udp, 3478/udp; leader also 7844
  - [ ] `docs/design/cluster.md` PR (repo rule: design doc before implementation) — files: `docs/design/cluster.md`, this task pair
    - [x] write `docs/design/cluster.md` (implemented parts with the real values; stage 05+ as designed; resource cap and volume size as proposals)
    - [x] `docs/system-definition.md` §5.1 site values (wall-port uplink, firewall by source address, outbound ports, 7844 open, OS, return image), §5.2 and §6 pointers to the design doc
    - [x] `docs/ai-scope.md`: Tailscale remote access in use, node OS tools row, tunnel port checked
    - [ ] open the PR (issue first), then confirm the proposed cap values with the server owner
    - [ ] follow-up PR: `docs/architecture/*.drawio.svg` still say Wi-Fi per node / no uplink (cluster, overview, user3-visitor)
- [ ] 05 k3s install — leader with embedded etcd (`--cluster-init`), node IP on the node network, Tailscale address in the API cert, default CoreDNS off, versions pinned; workers join; labels + leader taint; CoreDNS on both workers. Check: ufw FORWARD default DROP does not block pod traffic; Docker does not bypass ufw
- [ ] 06 Reboot tests — each worker, then the leader, then a full power cut
- [ ] 07 Image pulls — GHCR pull-through cache on the leader (local-path), nodes fall back to GHCR directly
- [ ] 08 Student namespace template — `proj-<id>`, Pod Security baseline enforced, resource cap under half a worker, NetworkPolicy (same namespace + Ingress in, same namespace + DNS out)
- [ ] 08′ Student volume and DB failover — Longhorn 2 replicas on the workers, MySQL per project, node-down pod deletion policy, failover timing
- [ ] 09 Server link — Tailscale tag and ACL, server ServiceAccount + RBAC + ValidatingAdmissionPolicy, Secret write-only
- [ ] 10 Public entry — Cloudflare Tunnel from the leader, Traefik (2 replicas) on the workers, the demo student address over HTTPS
- [ ] 11 Monitoring — Prometheus + Grafana on the leader (local-path), server queries Prometheus, Discord alerts
- [ ] 12 Return — Clonezilla restore of all three disks, BIOS back to the photos, secrets revoked

## Done when

- [ ] demo path on the cluster: the server deploys a test app into `proj-demo` and the demo student address (`demo.<domain>`, domain still an open team question) opens over HTTPS with one worker powered off
- [ ] `docs/design/cluster.md`, ADRs and `docs/ai-scope.md` match what is installed
- [ ] the three PCs are returned in their original state (stage 12)
