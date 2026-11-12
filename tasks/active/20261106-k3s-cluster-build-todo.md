# k3s cluster build on the three school PCs

- **SRS**: no FR yet (infra; SRS FR table still empty) — serves NFR-OPS-01 (student URLs reachable until judging ends) and NFR-SEC-01 (no secrets in the repo)
- **Owner**: 유성 (seren-wib)
- **Branch**: docs/cluster-design (first PR: `docs/design/cluster.md` + this task pair); cluster code later goes under `Infra/` on its own branches
- **Issue**: https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/30
- **Decisions**: [ADR-003](../../docs/adr/003-registry-ghcr.md) registry, [ADR-004](../../docs/adr/004-server-cluster-link-tailscale.md) server link, [ADR-005](../../docs/adr/005-k3s-cluster-on-school-pcs.md) cluster, [ADR-006](../../docs/adr/006-metrics-on-leader-prometheus.md) metrics, [ADR-008](../../docs/adr/008-node-network-on-school-wired-lan.md) node network

## Plan

Build a leader + 2 worker k3s cluster on the three lent school PCs, stage by stage, each stage gated by a "done when" check. The detailed stage plan (premises, trade-offs, commands per stage) is kept outside the repo by the infra owner; this file tracks the stages and the repo-side deliverables. Everything after stage 01 is done remotely over Tailscale SSH with key login and passwordless sudo.

Rules for remote changes that can cut access (network, sshd, firewall): one PC at a time, w2 → w1 → leader, and arm an automatic revert first (`systemd-run --on-active=150 <undo>`), apply, reconnect from outside, then cancel the revert timer.

Priorities: the demo path first. Deferred (후순위): moving cloudflared from the leader to both workers, etcd snapshots to R2, Ansible playbooks. The AI teammate's deploy redesign (v15, settled 2026-11-07): build stays on AWS CodeBuild, students bring their own DB, backend + AI server + GoCD server on one EC2, Qwen3-8B-AWQ on the leader GPU. Its cluster work is folded into the stages below (GPU toolkit first in 05, 06′, 09′, extra items in 11).

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
  - [x] `docs/design/cluster.md` PR (repo rule: design doc before implementation) — files: `docs/design/cluster.md`, this task pair — #31, merged 2026-11-07
    - [x] write `docs/design/cluster.md` (implemented parts with the real values; stage 05+ as designed; resource cap and volume size as proposals)
    - [x] `docs/system-definition.md` §5.1 site values (wall-port uplink, firewall by source address, outbound ports, 7844 open, OS, return image), §5.2 and §6 pointers to the design doc
    - [x] `docs/ai-scope.md`: Tailscale remote access in use, node OS tools row, tunnel port checked
    - [x] open the PR (issue first) — #30 / #31
    - [x] ~~confirm the proposed cap values with the server owner~~ — decided by the infra owner 2026-11-10 (the server only creates the template as written and never reads the values); shared through the 08 PR
    - [x] follow-up PR: `docs/architecture/*.drawio.svg` still said Wi-Fi per node / no uplink and showed student volumes (cluster, overview, user3-visitor) — #33 / #34
- [x] 05 k3s install (2026-11-07) — k3s v1.37.2+k3s1, options in `/etc/rancher/k3s/config.yaml` (`Infra/k3s/server.yaml`, `agent.yaml`)
  - [x] nvidia-container-toolkit on the leader (1.20.1 already there as received; k3s registered the `nvidia` runtime)
  - [x] leader: embedded etcd, node IP + API cert names, CoreDNS and ServiceLB off, Secrets encryption, control-plane taint, 30 s tolerations, NodePorts on the node network only
  - [x] flannel `host-gw` with the node address as next hop (VXLAN used the school address)
  - [x] workers joined with `wanggane/pool=student`
  - [x] own CoreDNS on both workers (`Infra/coredns/coredns.yaml`)
  - [x] checks: 3 nodes Ready, cross-worker Pod traffic, DNS, Pod HTTPS out, school-side 6443/80/443 closed, Docker rules only on `docker0`, `ufw route allow` for the Pod CIDR
  - [x] k3s token: the server token is on the leader and on both workers (`/etc/rancher/k3s/token`); the operator keeps a copy in a password manager. A team shared vault waits until there are secrets teammates must use (vLLM key, tunnel token)
  - [x] repo PR #37 (issue #35): `Infra/k3s/*`, `Infra/coredns/coredns.yaml`, `docs/design/cluster.md` §3–4, `docs/ai-scope.md`, `docs/system-definition.md` §5.1–5.2, reboot results (this log went in with #34)
- [ ] 06 Reboot tests — each worker, then the leader, then a full power cut
  - [x] w1 → w2 → leader, one at a time, remotely (2026-11-08): each back in ~35–45 s unattended; NotReady measured at ~50 s (agent stopped), rescheduling at ~80 s
  - [ ] full power cut (on site)
- [x] 06′ Leader GPU + vLLM — NVIDIA device plugin, Qwen/Qwen3-8B-AWQ on vLLM (16K context, one request at a time, API key in a leader Secret), no public route; measure GPU memory. Team priority: 후순위 since the 2026-11-09 meeting — done off the demo path the same day. Manifests in `Infra/gpu/` · `Infra/vllm/`, design in cluster.md §11 (#38). Left: copy the API key to the team vault
- [x] 07 Image pulls (2026-11-10, issue #62, PR #63) — GHCR pull-through cache on the leader (`registry:3.1.2` proxy mode, hostNetwork on 192.168.77.11:5000, local-path; `Infra/registry-cache/`), `/etc/rancher/k3s/registries.yaml` on all three (`Infra/k3s/registries.yaml`); second worker pulls from the cache only, a stopped cache falls back to GHCR directly
- [x] 08 Student namespace template (2026-11-10, issue #64) — `proj-<id>`, Pod Security baseline enforced, resource cap under half a worker (plus no PVC, NodePort or LoadBalancer), NetworkPolicy (same namespace + Ingress in; same namespace + DNS + internet out, school LAN / cluster / node / tailnet / private ranges / other projects blocked). Template `Infra/student/space.yaml` applied as `proj-demo` with a podinfo test app (`app-example.yaml`); `Infra/student/check.sh` passes; design in cluster.md §6
- [x] ~~08′ Student volume and DB failover~~ — dropped 2026-11-07: students bring their own DB (deploy workflow v15), so no platform MySQL or Longhorn; 08 opens student Pod egress to the internet instead
- [ ] 09 Server link (issue #84)
  - [x] first part (2026-11-10): server ServiceAccount `platform/platform-server` + RBAC (namespace create/delete, cap · defaults · isolation create only, Secret create/update only), five ValidatingAdmissionPolicies (proj- only, namespace labels, Secret type and name, template values compared against the `student-template` namespace, student Pods and Deployments without an API token and with NET_RAW dropped); `Infra/platform/` with `check.sh` passing, also with the real token over the leader's Tailscale address from the operator's machine
  - [x] Tailscale tag and ACL (2026-11-10) — `Infra/tailscale/acl.hujson` saved in the admin console by the tailnet owner (it replaced the default allow-all policy); operator SSH and the leader API still work, node-to-node over the tailnet is closed
  - [x] EC2 joins the tailnet and reaches the leader API (2026-11-12): tagged `tag:platform-server` through an approved login, no auth key; 401 without a token; server-account tests from the EC2 in cluster.md §8 (PR #154)
  - [x] reads (2026-11-10): kept to proj- spaces by a fifth template object, the RoleBinding `platform-server-read` to the role `proj-reader` (Pods, logs, Deployments), which the server creates with the space; nodes cluster-wide; policy `wanggane-space-readers` (since 09′ the template has six objects and `Infra/platform/policies.yaml` seven policies)
  - [x] second part (2026-11-11): action rights for the server (restart, stop/resume) with a policy that limits the change to scale and the restart annotation; tests in cluster.md §8
- [ ] 09′ GoCD Agent on the leader — connects to the GoCD server on the EC2 over Tailscale, deploy rights move to its ServiceAccount (cluster.md §8 split, ADR-009), Verify path through Traefik; docs for the AI parts. Check the AI teammate's ArgoCD review first: if the team switches, this stage changes
  - [x] account and rules (2026-11-11, issue #112): ServiceAccount `deploy/deploy-executor` with no cluster-wide rights; role `proj-deployer` (Deployment, Service, ConfigMap, Ingress, Traefik Middleware write; Pod, event, Endpoints read; no Secrets) held only through a sixth template object, the RoleBinding `deploy-executor`, which the server creates with the space; policies `wanggane-deploy-executor` (proj- only), `wanggane-student-middlewares` (stripPrefix only, #72), `wanggane-student-services` (ClusterIP, no externalIPs), `wanggane-space-deployers`, and no toleration or nodeName in `wanggane-student-pods`; `Infra/executor/` with `check.sh` passing
  - [x] the Agent Pod manifest and its egress policy (2026-11-11, issue #131): `Infra/executor/agent.yaml`, applied 2026-11-12; checked before that with a throwaway Pod of the same shape (`Infra/executor/agent-check.sh`)
  - [x] apply the Agent Pod and the Secret `gocd-agent` (2026-11-12, issue #164): three keys (server address, auto-register key, notify token) from SSM `/wcp/gocd/`, registered as `k3s-leader-executor` with resource `leader`; the leader → EC2 GoCD port rule was saved the same day (#127)
  - [ ] end to end: the test pipeline deploys to `proj-demo` through Verify on the leader executor (#135)
- [x] 10 Public entry (2026-11-10, issue #90) — locally managed tunnel `wanggane` with cloudflared 2026.10.7 on the leader (`Infra/cloudflared/`), `*.stairnoworks.com` as a proxied CNAME to it, Traefik with two replicas, one per worker (`Infra/k3s/traefik-config.yaml`), `https://demo.stairnoworks.com` open over HTTPS with a valid certificate; reserved slugs and platform names (`app`, `api`) in cluster.md §9 and ADR-013
  - [x] one worker off: the demo address came back after ~80 s on the other worker
  - [x] internet path cut on the leader for 120 s (default route removed): see the lessons log for the recovery times
  - [ ] pull the real wall cable once on site (with the stage 06 power-pull test)
  - [ ] deferred: cloudflared on both workers and the leader-off test
- [ ] 11 Monitoring — Prometheus + Grafana on the leader (local-path), server queries Prometheus, Grafana embedded in the operator page. Scope: cluster.md §10
  - [x] first part (2026-11-11, issue #130): the server account reads CPU and memory through `metrics.k8s.io` (the metrics-server k3s ships): nodes cluster-wide, Pods through `proj-reader`
  - [x] install (2026-11-11, issue #136): kube-prometheus-stack 93.1.1 through a k3s HelmChart, chart from GHCR; all targets up; the server account queries Prometheus through the service proxy (`Infra/monitoring/check.sh`)
  - [x] public Grafana address for the operator page's iframe (2026-11-12): `grafana.stairnoworks.com` through the tunnel and Traefik, `allow_embedding`, NetworkPolicy lets only Traefik in; no anonymous access
  - [ ] seen working inside the operator page (needs the FE); a localhost FE is another site, so the login cookie needs `cookie_samesite = none` there
  - [ ] deferred: Grafana JWT login with the platform token, so the operator does not log in twice (needs the Supabase project URL)
  - dropped from the cluster side (2026-11-12, team): Discord alerts from Grafana moved to the platform side; Cloudflare tunnel status notification not checked
- [ ] 12 Return — Clonezilla restore of all three disks, BIOS back to the photos, secrets revoked, and in the Tailscale admin console the teammates' node shares revoked and the `autogroup:shared` ACL rule removed (the disk restore does not touch either)

## Done when

- [ ] demo path on the cluster: the server deploys a test app into `proj-demo` and the demo student address (`demo.stairnoworks.com`) opens over HTTPS with one worker powered off
- [ ] `docs/design/cluster.md`, ADRs and `docs/ai-scope.md` match what is installed
- [ ] the three PCs are returned in their original state (stage 12)
