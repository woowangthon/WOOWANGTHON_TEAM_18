# Pipeline glue: fetch-input and notify CLIs (#135, PR-A)

- **SRS**: FR-049, FR-056, FR-059
- **Owner**: TaeTaeJin (with Claude Code)
- **Branch**: feat/pipeline-glue

## Plan

The GoCD jobs need two small programs between the platform server and the stage CLIs that already exist in `Infra/pipeline`:

- `fetch-input`: `GET /api/pipeline/deploys/:id/input`, then write `deploy-input.json` and the slot to files the jobs can pass on.
- `notify`: turn a stage report (`{ ok, failure }`, or the build report) into the `POST /api/pipeline/notify` body and send it.

Decisions (the contract is `docs/design/api.md` "파이프라인 ↔ 플랫폼 서버", the body check is `validateNotice` in `BE/src/deploys/deploy-run.ts`):

- CLI shape (fixed with the coordinating session, the GoCD YAML is built on it): `fetch-input <out-dir>` and `notify <stage> <report.json>`, env `DEPLOY_ID` · `PLATFORM_API_URL` · `PIPELINE_NOTIFY_TOKEN`; exit 0 sent, 1 the server answered 4xx, 2 anything else. A report that is missing, not JSON or of the wrong shape is sent as platform code `STAGE_NO_REPORT`, so the run does not wait for the 1-hour timeout.
- One shared client `src/platform-api.ts`: `PLATFORM_API_URL` (https, or http on loopback only) and `PIPELINE_NOTIFY_TOKEN` (32+ chars, no whitespace) from env; global `fetch`; 10 s per call; retries on 503 and on a connection error with 1 s / 2 s / 4 s waits (4 attempts); the token goes only into the header and never into an error.
- Mapping is a pure function in `src/notify.ts` (no I/O), so the table of cases is the test.
- Platform failure → `failure.code` (an unusable code is replaced by `PIPELINE_FAILED`, never `null`, because `null` would send the run to the AI agent). Student failure → `code: null` plus `raw.k8s`; `status` only for `render` (BE wants an object there, so an unreadable status becomes `{ message }`).
- Build failure → `raw.codebuild = build`, `logs` = `logTail` and the build start/end times as UTC ISO strings.
- Several failed services: a platform failure wins, else the first student failure in spec order (the report is already in spec order).
- `verify` / `switch` reports are accepted with the same `{ ok, failure }` shape. Not built here.

## Todo

- [x] Read api.md, `validateNotice`, the existing CLIs and reports
- [x] `src/platform-api.ts` + spec (env, retry, errors, token never printed)
- [x] `src/fetch-input.ts`, `src/cli/fetch-input.ts` + spec
- [x] `src/notify.ts`, `src/cli/notify.ts` + spec (mapping table, body accepted by BE's `validateNotice`)
- [x] Docs: Layout row in `Infra/pipeline/CLAUDE.md`, one line in `docs/design/api.md`
- [x] `pnpm verify`, hand mutants on mapping and retry, `/code-review low`, `/simplify`
- [ ] Draft PR (`Refs #135`)

## Done when

- [ ] `pnpm verify` in `Infra/pipeline` exits 0
- [ ] Every body the mapper makes passes BE's `validateNotice` (a test imports it)
- [ ] tests added; mutation survivors resolved or explained
