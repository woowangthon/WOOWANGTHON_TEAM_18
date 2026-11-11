# Agent: trial run contract — lessons

## Log

- 2026-11-11: The first draft reused `student-deploy` with a stage filter and a `START_STAGE` platform run for Switch. The coordinating session merged it with track A's plan: a separate `student-trial` pipeline without Switch, so a trial can never change the public address. Switch after `verified` is decided in a later PR.
- 2026-11-11: Platform problems during a trial needed a place in the tool result; added one `failure` field (`stage`, `code`, `message`) to the three run tools instead of new rejection codes, so the agent's stop codes stay as they are (`LIVE_SLOT_PROTECTED` is still a rejection).
- 2026-11-11: Track A's review: `run_verify` takes no patch but Verify reads paths from the input, so its input is the last successful `run_deploy`'s; without it a fixed health path is checked at the old path. Also each trial job reads the input itself (no Build job to hand it on), and a missing stage report is `STAGE_NO_REPORT`.
- 2026-11-11: User decision for `verified`: no switch-only pipeline; re-run `student-deploy` from the start with the fixed input. It works only if the build is skipped, so `build_cache` is written when Build passes, not at Switch. The re-run's Verify is the re-check ADR-012 asks for, so the ADR stays.

## Lessons

- A tool with no input argument still has an input: say where it comes from in the contract (`run_verify` and the last deploy).
- Shell substitution does not happen inside a tool argument: `$(file)` went out as text. Paste the content itself.
