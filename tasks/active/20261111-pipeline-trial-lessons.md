# Trial run, pipeline side (F11b A1) — lessons

## Log

- 2026-11-11: Design sent as option B (trial-only pipeline without a Switch stage); the user chose it and track B wrote the contract (#147). Reviewed the contract drafts from the pipeline side: `run_verify` input, `STAGE_NO_REPORT`, per-job input reads, `failedPhase` as a string, the 20-minute build timeout cap, `cache` meaning.
- 2026-11-11: Split A1/A2: the trial result messages must match #142's notify messages, so `trial-report` waits for #142 instead of copying its client and message rules.
- 2026-11-11: Open question sent to coordination: a `run_build` whose service turns out `reuse` has no `run` service in the input, so the pipeline cannot tell which image to report; proposed that BE answers it without scheduling.
- 2026-11-12: A1 merged (#148). A1b on team main 2feae58 (#142 · #141 · #150 merged). BE's `checkTrialResult` lived in `trials.ts` next to Nest imports, which the pipeline package cannot resolve, so it moved to `trial-result.ts` (same code, re-exported) and `trial-report.spec.ts` checks every body against it. run_build is not in BE yet (B3): its bodies are checked against the api.md tool table only.
- 2026-11-12: #158 review follow-up (fix/trial-report-review): api.md §4 status line, a comment on why pipeline.yml watches two BE files, a passed report with a non-null failure is now a shape error (STAGE_NO_REPORT), and `TRIAL_ID` moved to `platform-api.ts` so `fetch-input` does not pull in the trial mapper.
- 2026-11-12: A2 (feat/gocd-student-trial). GoCD cannot skip a stage by a variable, so every task goes through `job.sh trial <stage>`, which passes without doing anything outside TRIAL_STAGES. A skipped Render still publishes an `out/` so Apply's fetch task (which cannot be made conditional) finds it. The trial input is already built (all reuse + digest), so fetch-input's output is copied as the built input and the stage steps of student-deploy are reused unchanged. Not run on a real GoCD (no docker here).

## Lessons

<filled when done>
