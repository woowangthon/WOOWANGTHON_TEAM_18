# Trial run, pipeline side (F11b A1)

- **SRS**: UC-14 (P0) — FR-076, FR-098, FR-099
- **Owner**: suda5936 (track A)
- **Branch**: feat/pipeline-trial-report (A1, #148), feat/pipeline-trial-report-cli (A1b)

## Plan

Contract: `docs/design/api.md` "파이프라인 ↔ 플랫폼 서버" 4 (#147, ADR-014). This PR is the part that does not need #142's `platform-api.ts`:

- Switch CLI guard: env `TRIAL_ID` present → write a `TRIAL_SWITCH_REFUSED` report and exit 1 before reading the input or the cluster.
- Build CLI third argument `build-overrides.json` (`null` or `{ computeType?, timeoutMinutes?, image?, cache? }`): StartBuild `computeTypeOverride` · `timeoutInMinutesOverride` · `imageOverride` · `cacheOverride: { type: NO_CACHE }` for `cache: false`. `timeoutMinutes` 1~20; with it the build wait is timeout + 5 min.
- Next PR (A2, after #142): `trial-report` CLI (stage reports → tool result + failure, once per trial) and the trial branch of `fetch-input` (`?counter`, `build-overrides.json`). Splitting avoids copying #142's client and its failure-message rules.

## Todo

- [x] Switch guard — files: `src/switch.ts`, `src/cli/switch.ts`, `src/switch.spec.ts`, `src/cli/switch.spec.ts`
- [x] Build overrides — files: `src/build.ts`, `src/cli/build.ts`, `src/build.spec.ts`
- [x] Docs — files: `Infra/pipeline/CLAUDE.md`, `docs/design/deploy-workflow.md`, `docs/design/AIagent.md`, `docs/ai-scope.md`
- [x] A1b: `trial-report` (stage report → tool result + failure, once per trial, STAGE_NO_REPORT, one-retry on 400, `TRIAL_INPUT_INVALID` when a run_build input does not have exactly one `run` service) — files: `src/trial-report.ts`, `src/cli/trial-report.ts`, `src/notify.ts` (export the failure sentence functions), tests `src/trial-report.spec.ts`, `src/cli/trial.spec.ts`
- [x] A1b: `fetch-input` trial branch (`?counter=$GO_PIPELINE_COUNTER`, `build-overrides.json`) — files: `src/fetch-input.ts`, `src/cli/fetch-input.ts`
- [x] A1b: BE `checkTrialResult` moved to a Nest-free file so the pipeline test can import it — files: `BE/src/gateway/trial-result.ts`, `BE/src/gateway/trials.ts`

- [x] A2: `student-trial` GoCD pipeline (user decision 2026-11-12: track A writes it) — files: `Infra/gocd/student-trial.gocd.yaml`, `Infra/gocd/job.sh` (`trial` wrapper, `trial-fetch-input`, `trial-report`, build overrides), `Infra/gocd/setup.sh` (waits for both pipelines), test `Infra/pipeline/src/gocd-trial.spec.ts`, docs

## Done when

- [ ] `pnpm verify` in `Infra/pipeline/` passes — PASS from the test session
- [ ] hand-made mutants on the guard and the override mapping are killed or explained
