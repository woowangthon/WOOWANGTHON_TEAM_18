# Agent: trial run contract — lessons

## Log

- 2026-11-11: The first draft reused `student-deploy` with a stage filter and a `START_STAGE` platform run for Switch. The coordinating session merged it with track A's plan: a separate `student-trial` pipeline without Switch, so a trial can never change the public address. Switch after `verified` is decided in a later PR.
- 2026-11-11: Platform problems during a trial needed a place in the tool result; added one `failure` field (`stage`, `code`, `message`) to the three run tools instead of new rejection codes, so the agent's stop codes stay as they are (`LIVE_SLOT_PROTECTED` is still a rejection).
- 2026-11-11: Track A's review: `run_verify` takes no patch but Verify reads paths from the input, so its input is the last successful `run_deploy`'s; without it a fixed health path is checked at the old path. Also each trial job reads the input itself (no Build job to hand it on), and a missing stage report is `STAGE_NO_REPORT`.
- 2026-11-11: Ticket limit raised to 3 per run, and the build_cache code move goes to the #107 owner (user decisions).
- 2026-11-11: User decision for `verified`: no switch-only pipeline; re-run `student-deploy` from the start with the fixed input. It works only if the build is skipped, so `build_cache` is written when Build passes, not at Switch. The re-run's Verify is the re-check ADR-012 asks for, so the ADR stays.
- 2026-11-11: Review applied (user, via the coordinating session). Taken as asked: time contract (token expiry = min(start + 60 min, start + 15 min + waits), stale check skips a `fixing` run whose token is still live), cancelling a leftover `student-trial` instance and waiting for it before the next trial or the re-run, `run_deploy` result assembly, build-stage tickets cannot trial, trial id checks, known limits (one shared executor, ticket limit per run only, non-deterministic builds in `build_cache`). Taken in another form: the review asked to edit ADR-012's body, but `docs/adr/README.md` allows only the status line on an earlier ADR, so the change is a new ADR-014 and ADR-012 gets `유효 (일부 대체: … → 014)`. The migration comment to fix later is in the root `supabase/migrations/`, not `BE/supabase/`. Added one item not in the review: the trial input read carries `?counter=<GO_PIPELINE_COUNTER>` so BE knows which GoCD instance to cancel.
- 2026-11-11: User decision: `student-trial` gets a Build stage (AWS executor) so the agent can fix build failures too; still no Switch. `run_build` picks its service by marking only that service `run` in the trial input (no extra env); `buildOverrides` ride next to `input` in the input response. A passed trial build is remembered as the ticket's trial image and written to `build_cache`. A flow picture in api.md 4 and ADR-014 says the public address changes only in `student-deploy`'s Switch. Gateway: B1 opens render/deploy/verify, B3 opens `run_build`.

## Lessons

- A tool with no input argument still has an input: say where it comes from in the contract (`run_verify` and the last deploy).
- When a review asks to edit an accepted ADR's body, write a new ADR and change only the old one's status line (`docs/adr/README.md`).
- Shell substitution does not happen inside a tool argument: `$(file)` went out as text. Paste the content itself.
