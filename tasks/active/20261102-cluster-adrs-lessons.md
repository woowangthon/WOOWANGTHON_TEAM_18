# Cluster ADRs: registry (GHCR) and server link (Tailscale) — lessons

## Log

- 2026-11-02: Scope of #14 cut down to the two decisions already agreed (registry, server link). The volume decision waits for the PC spec check (PCs arrive 2026-11-03) because the replica tier depends on worker RAM. The rule change needed to supersede one item of ADR-001 went to its own issue (#19) so it can be reviewed as a rule, not inside an ADR PR.
- 2026-11-02: Both ADRs name the technology even though diagrams and §4 use component names only; #19 makes ADRs and ai-scope the exception, since naming the technology is what they are for and ADR bodies never change after merge.

- 2026-11-03: Added ADR-005 (k3s cluster layout) and ADR-006 (metrics, no time-series DB): both decided and expensive to reverse but never recorded. The remaining cluster ADRs (volumes, public entry, logs if decided) wait for the on-site checks.

## Lessons

<filled when done>
