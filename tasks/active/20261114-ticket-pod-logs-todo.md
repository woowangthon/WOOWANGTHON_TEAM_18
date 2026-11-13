# Problem ticket: fill the logs from the target slot Pod (F08)

- **SRS**: UC-14 (P0) — FR-098 "a problem ticket with the logs around the error"
- **Owner**: track B (AI agent), BE side
- **Branch**: feat/ticket-pod-logs (from team `main` 604a4ad)

## Plan

Contract: `docs/design/api.md` "파이프라인 ↔ 플랫폼 서버" 3 (`failure.logs`), `docs/design/AIagent.md` §4 · §5. No contract change.

- In `DeployRunsService.sendTicket`: for `apply` · `verify` with a `failure.service` and no `logs.lines` from the pipeline, read the newest Pod of that service in the target slot (`app=<svc>,slot=<slot>`), last 200 lines of the last 10 minutes (`sinceSeconds=600`), the previous container when it restarted. Each line goes through `redactString`. The pipeline's logs win when present.
- The "newest Pod" rule moves to `newestPod()` in `BE/src/k8s/cluster-reader.ts`; the gateway's `read_pod_logs` uses it too.
- The read has a 3 s cap; a failure or a timeout sends the ticket with an empty log (no `AGENT_UNAVAILABLE`, no retry from the pipeline). Errors are logged without values.

## Todo

- [x] `newestPod`, `sinceSeconds` — files: `BE/src/k8s/cluster-reader.ts`, `BE/src/gateway/tools.ts`
- [x] Ticket logs — files: `BE/src/deploys/deploy-runs.service.ts`
- [x] Tests — files: `BE/src/k8s/cluster-reader.spec.ts`, `BE/test/deploy-runs.e2e.spec.ts`
- [x] Docs — files: `docs/design/api.md`, `docs/design/AIagent.md`

## Done when

- [ ] `pnpm verify` in `BE/` — from the test session
- [ ] mutation testing — hand mutants run by the test session
