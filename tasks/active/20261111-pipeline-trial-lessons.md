# Trial run, pipeline side (F11b A1) — lessons

## Log

- 2026-11-11: Design sent as option B (trial-only pipeline without a Switch stage); the user chose it and track B wrote the contract (#147). Reviewed the contract drafts from the pipeline side: `run_verify` input, `STAGE_NO_REPORT`, per-job input reads, `failedPhase` as a string, the 20-minute build timeout cap, `cache` meaning.
- 2026-11-11: Split A1/A2: the trial result messages must match #142's notify messages, so `trial-report` waits for #142 instead of copying its client and message rules.
- 2026-11-11: Open question sent to coordination: a `run_build` whose service turns out `reuse` has no `run` service in the input, so the pipeline cannot tell which image to report; proposed that BE answers it without scheduling.

## Lessons

<filled when done>
