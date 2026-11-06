# k3s cluster build on the three school PCs — lessons

## Log

- 2026-11-03: PCs received (lent for the contest, 24 h, in the club room). The OS sits on the internal NVMe and survives reboots, so the live-USB plan was dropped. One PC checked: i7-13700K, 125 GiB RAM, ~813 GB free NVMe, RTX 3080; the other two are similar. Uplink changed to: club-room wall LAN port → our unmanaged switch → three PCs.
- 2026-11-04: Disk image of each internal disk taken with Clonezilla before touching anything (for returning the PCs as received). All three run Ubuntu 24.04.5 minimized server, no Wi-Fi card, onboard 2.5G `enp4s0` free.
- 2026-11-05: Stage 01 done on site. The wall port works with the PCs' original static school addresses. Tailscale on all three; key login from the Mac and the desktop; passwordless sudo via one file in `/etc/sudoers.d/`; sleep masked; BIOS set to power on after AC loss; unattended reboot reconnects. Tailscale reaches the PCs through a DERP relay, not directly.
- 2026-11-06: Stage 02 finished remotely. No ufw on any PC (minimized image). Outbound TCP 7844 (Cloudflare Tunnel) is open on all three, and the school network is not 443-only, so the 7844 fallback plan is not needed. QUIC (UDP 7844) not checked; cloudflared falls back to TCP.
- 2026-11-06: Received the AI teammate's v14 deploy diagram (workflow + GoCD, AI agent on failure tickets, vLLM on the leader GPU, build inside the cluster, external student DB). Questions sent; decided to finish the current plan first and treat v14 as an add-on after stage 11. Proposed keeping the build on AWS.
- 2026-11-06: Stage 03 done. Hostnames set with `hostnamectl`, `/etc/hosts` 127.0.1.1 line renamed, and a cloud-init drop-in `preserve_hostname: true` added because `cloud.cfg` had `preserve_hostname: false` with `update_hostname`. Timezone Asia/Seoul. Rebooted w2 → w1 → leader; each came back with no local login.
- 2026-11-06: Stage 04 done in three blocks, each PC with a 150 s auto-revert armed first. (1) Node addresses in a separate netplan file; `netplan generate` showed both addresses and the single school gateway before applying. iperf3 ~941 Mbit/s on all pairs. (2) SSH keys only (password try returns `Permission denied (publickey)`), then ufw with allow rules first and deny incoming; node addresses reach :22, school addresses do not. (3) Deny outgoing with a port allowlist; DNS, HTTPS, GHCR, apt, NTP and Tailscale still work, other ports (e.g. 8080) are blocked, worker 7844 is blocked.

- 2026-11-06: Wrote `docs/design/cluster.md`. Writing it showed that system-definition §5.1 still described Wi-Fi per node and an isolated switch, which the design doc would contradict, so the §5.1 site values moved into the same PR (repo rule: a change and the doc it affects go together). Diagrams carry the same old premise and follow in their own PR.

## Lessons

- **Arm the undo before a change that can cut remote access.** `systemd-run --on-active=150 <undo>`, then apply, reconnect from outside, then `systemctl stop <unit>.timer`. Used for netplan, sshd and both ufw switches; none needed it, but a mistake would have cost a trip to the club room. *(Pitfalls candidate)*
- **cloud-init can rename the host back on reboot.** With `preserve_hostname: false` and the `update_hostname` module, add a `cloud.cfg.d` drop-in with `preserve_hostname: true` before relying on `hostnamectl`.
- **Add addresses in a second netplan file instead of editing `50-cloud-init.yaml`.** Netplan merges the address lists; check the merged result with `netplan generate` and the generated networkd file before `netplan apply`.
- **Ubuntu minimized server has no `ping` or `nmcli`.** Test reachability with `timeout 3 bash -c '</dev/tcp/<ip>/22'` and the internet with `curl -4 -sSI -m 8 https://tailscale.com`. Do not use 1.1.1.1 as a test target: the school network blocks it.
- **ufw cannot allow by domain.** Registries, package mirrors and Tailscale sit on CDNs, so outbound filtering is by port, not by host.
- **zsh does not word-split unquoted variables.** A `for pair in "host ip"; set -- $pair` loop silently passed the whole string as one argument; run such loops in bash.
