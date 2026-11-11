# Agent: trial run contract — lessons

## Log

- 2026-11-11: The first draft reused `student-deploy` with a stage filter and a `START_STAGE` platform run for Switch. The coordinating session merged it with track A's plan: a separate `student-trial` pipeline without Switch, so a trial can never change the public address. Switch after `verified` is decided in a later PR.
- 2026-11-11: Platform problems during a trial needed a place in the tool result; added one `failure` field (`stage`, `code`, `message`) to the three run tools instead of new rejection codes, so the agent's stop codes stay as they are (`LIVE_SLOT_PROTECTED` is still a rejection).

## Lessons

- Shell substitution does not happen inside a tool argument: `$(file)` went out as text. Paste the content itself.
