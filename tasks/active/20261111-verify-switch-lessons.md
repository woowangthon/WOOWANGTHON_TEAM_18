# Verify and Switch stages (W6, switch) — lessons

## Log

- 2026-11-11: The coordinator first asked for a `raw.verify` ticket shape; the merged contract (#109 AIagent.md §5, BE `checkEvidence`, AI `models.py`) only takes `raw.k8s` for verify, and BE drops unknown raw keys silently. Followed the merged contract; the full check table goes to `verify-report.json`.
- 2026-11-11: The old slot scale-down moved from W7 (platform server) to Switch: the platform server account has no Deployment write, the executor has patch.
- 2026-11-11: The local k3s from F04 was gone after the container restart, so Switch and Verify are covered by fakes and a loopback HTTP server only.

## Lessons

- Read the merged code that consumes a payload (validator, model) before building the producer; a design message can lag behind what was merged.
