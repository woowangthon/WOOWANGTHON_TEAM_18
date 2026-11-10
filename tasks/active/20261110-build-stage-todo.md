# Build stage (W4): default Dockerfiles, shared buildspec, CodeBuild start and wait

- **SRS**: none yet (SRS §4 has no FR for the deploy flow; track A F02 assigned by the coordination session)
- **Owner**: suda5936
- **Branch**: feat/build-stage

## Plan

New package `Infra/pipeline/` (pnpm, Vitest, ESLint, same tools as BE) for the judgement code of the GoCD stages; GoCD tasks run `node dist/cli/<stage>.js` and the package calls the `aws` CLI without a shell. Build stage: StartBuild per `run` service in parallel (`NO_SOURCE`, the shared buildspec inline), poll BatchGetBuilds every 10 s (cap 20 min), read the exported `IMAGE_DIGEST`, and on failure report `builds[0]` raw, the failed phase and the last 200 log lines; API errors are platform failures. The buildspec fetches the student commit and the platform repo (default Dockerfiles, `build.sh`) over public git. `build.sh` blocks link-local metadata, builds, checks the image (size ≤ 2 GiB, warn on root), then takes the GHCR token from Secrets Manager only after the student build is done. Image check is rule-based pending the coordination session's answer (option 1). Design: `docs/design/deploy-workflow.md` W4, `docs/design/deploy-handoff.md`, `docs/design/AIagent.md` §3 `run_build`.

## Todo

- [x] Package setup and CI — files: `Infra/pipeline/*`, `.github/workflows/pipeline.yml`
- [x] Default Dockerfiles and their version lock — files: `Infra/build/dockerfiles/*`
- [x] Shared buildspec and build script — files: `Infra/build/buildspec.yml`, `Infra/build/build.sh`
- [x] StartBuild / BatchGetBuilds / logs, tag, digest, failure report — files: `Infra/pipeline/src/build.ts`, `src/cli/build.ts`
- [x] Docs — files: `docs/design/deploy-workflow.md`, `docs/design/deploy-handoff.md`, `docs/ai-scope.md`, `CLAUDE.md`, `Infra/pipeline/CLAUDE.md`

## Done when

- [x] `node dist/cli/build.js` turns the handoff example into a report with digests, against a fake `aws` on PATH
- [x] default Dockerfiles build and run locally (vite-react, nest)
- [x] tests added; hand-made mutants killed or explained
- [ ] one real CodeBuild run (needs the AWS project, IAM key and the GHCR bot token)
