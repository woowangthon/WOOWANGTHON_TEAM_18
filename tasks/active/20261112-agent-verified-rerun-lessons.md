# Gateway: verified → re-run — lessons

## Log

- 2026-11-12: The ticket count reuses `agent_result` (`tickets`), no migration. A second ticket only comes after a verified re-run fails, and then `agent_result` still holds the earlier ticket's result, so the count rides along with it. The student view (`toAgent`) never reads the field.
- 2026-11-12: "Same specPatch" is checked on the patched input, not on the patch text: two patches that give the same input are the same trial. A `run_verify` that checked the run's original input (no `run_deploy` yet) does not count.
- 2026-11-12: The AI fake gateway's run_* defaults had no `failure` field, which the BE always sends; added `failure: None` so the fake matches the real shape.
- 2026-11-12: Two hand mutants survived the first run. The run_verify-without-run_deploy test used a non-empty patch, so the equality check rejected it first and the record condition was never the deciding one; a test now submits the empty patch. A zero count gives 1 with or without the `> 0` guard; a negative one tells them apart.

## Lessons

- Before reusing a column for a counter, check every reader of that column ignores the new key.
- A test for one guard must make that guard the only thing that rejects; pick inputs the earlier checks let through.
