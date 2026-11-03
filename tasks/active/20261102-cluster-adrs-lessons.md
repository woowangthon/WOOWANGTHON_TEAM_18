# Cluster ADRs: registry (GHCR) and server link (Tailscale) — lessons

## Log

- 2026-11-02: Scope of #14 cut down to the two decisions already agreed (registry, server link). The volume decision waits for the PC spec check (PCs arrive 2026-11-03) because the replica tier depends on worker RAM. The rule change needed to supersede one item of ADR-001 went to its own issue (#19) so it can be reviewed as a rule, not inside an ADR PR.
- 2026-11-02: Both ADRs name the technology even though diagrams and §4 use component names only; #19 makes ADRs and ai-scope the exception, since naming the technology is what they are for and ADR bodies never change after merge.
- 2026-11-03: Added ADR-005 (k3s cluster layout) and ADR-006 (metrics, no time-series DB): both decided and expensive to reverse but never recorded. The remaining cluster ADRs (volumes, public entry, logs if decided) wait for the on-site checks.
- 2026-11-03: Review round. ADR-005 said running student services stay reachable during a leader outage and cited §5, but §5 still routes visitors through the leader, and worker-side entry is only planned. The sentence now defers to the public-entry decision. SRS §1.6 still carried the old "nodes join only during school-allowed hours" premise from the lab-PC plan and was corrected here; SRS line 88 (leader runs Ingress) waits for the public-entry ADR. §6 dropped the items these ADRs settle.

## Lessons

- **An ADR must not lean on a decision that is not made yet.** ADR bodies freeze at merge; a sentence that assumes a pending choice (worker-side entry) either goes into that choice's own ADR or says it is decided there. *(Pitfalls candidate)*
- **Before citing a doc section in an ADR, check that the section says it today.** The `(§5)` reference pointed at text that said the opposite.
- **Grep the SRS for the premise an ADR replaces.** The 24-hour lent PCs contradicted SRS §1.6; the reviewer bot caught it, not us.
