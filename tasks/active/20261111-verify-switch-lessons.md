# Verify and Switch stages (W6, switch) — lessons

## Log

- 2026-11-11: The coordinator first asked for a `raw.verify` ticket shape; the merged contract (#109 AIagent.md §5, BE `checkEvidence`, AI `models.py`) only takes `raw.k8s` for verify, and BE drops unknown raw keys silently. Followed the merged contract; the full check table goes to `verify-report.json`.
- 2026-11-11: The old slot scale-down was first put in Switch, on the belief that the platform server could not write Deployments. #125 and #134 had already given it scale 0 · 1, and #137 scales down in W7 after `live_slot` changes. Two places doing it, and Switch failing on the scale-down after the open Ingresses moved would leave `live_slot` on the old slot (next deploy stops at LIVE_SLOT_PROTECTED). Removed from Switch; W7 keeps it.
- 2026-11-11: The local k3s from F04 was gone after the container restart, so Switch and Verify are covered by fakes and a loopback HTTP server only.

## Lessons

- Put a step that may fail after the point of no return outside the stage whose result decides the DB state; a late failure must not hide that the switch already happened.
- Check the current permissions on main before stating "X has no permission" as a reason; infra PRs change it.

- Read the merged code that consumes a payload (validator, model) before building the producer; a design message can lag behind what was merged.
