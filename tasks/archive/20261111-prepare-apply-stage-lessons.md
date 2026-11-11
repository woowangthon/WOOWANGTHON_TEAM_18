# Prepare and Apply stages (W5) — lessons

## Log

- 2026-11-11: The executor role (#114) has no `deletecollection` and no Pod logs, so slot cleanup lists by label and deletes one by one, and Apply reads Pod status and events only; logs for a ticket come from the platform server.
- 2026-11-11: Test Ingress cleanup moved to Prepare: Prepare runs before Render and has the deploy input, so the set to keep is `test-<name>` of the public services, no manifest needed.
- 2026-11-11: Ticket contract: `raw.k8s.status` only for render. An apply-stage refusal (after dry-run passed) is therefore reported as a platform problem with the Status in `detail`.
- 2026-11-11: Local k3s in docker: admission, apply, label cleanup and the Ready timeout work; Pods never start there (runc in nested containers: "can't get final child's PID"), even after importing the pause image. Fast-fail signals are covered by fakes only.

## Lessons

- A 403 is not always a permission problem: `exceeded quota` is also 403 and is the student's to fix. Classify by message (`cannot <verb> resource`), not by code.
