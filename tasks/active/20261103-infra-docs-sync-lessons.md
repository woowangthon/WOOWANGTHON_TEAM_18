# Infra docs sync — lessons

## Log

- 2026-11-03: #16 and #18 merged into one PR at 유성's request, branched from #21 (expected to merge) instead of waiting for it. Priorities fixed before writing: public entry on the leader for now; worker-side tunnel client and worker backups to off-cluster storage are 후순위 (after the 3rd-priority items in the build plan). The issue bodies (written 2026-11-01) still list Longhorn + R2 and worker-side entry as planned; the PR body records the difference instead of editing the issues.
- 2026-11-03: Rewrote §3 rows, §4, §5, §6 and ai-scope in four commits. Undecided items are written as undecided rather than as the 11-01 plan: student volume (no product name outside §3 and ai-scope), OS path, logs (proposal recorded in §6), etcd snapshot storage. Old-term scan over both files is clean except the §7 rule example. `cluster.drawio.svg` still draws worker-side tunnel connectors and the old backup priorities; left for #17.
- 2026-11-03: Student volume first went in as 결정 전; the build plan marks it 예정 (the tier rule is agreed, only the PC spec is missing). Corrected to 예정 across §3, §4, §5.2 and ai-scope. A pending ADR does not make a decision undecided when the rule is already agreed.
- 2026-11-03: Consistency pass before the PR. Found the §3 slot term still counting standby replicas, and SRS §1.3 / §1.5 / §1.6 / §1.7 still describing standby replicas and off-cluster volume copies (plus the dead `system-architecture.drawio.svg` link). Fixed both here so the PR leaves no doc contradicting another; the Notion SRS needs the same edit. Diagrams stay with #17.

## Lessons

<filled when done>
