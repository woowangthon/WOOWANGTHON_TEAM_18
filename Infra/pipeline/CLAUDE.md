# Infra/pipeline/CLAUDE.md

The root [`CLAUDE.md`](../../CLAUDE.md) rules apply; this file adds the commands and layout of `Infra/pipeline/`.

The judgement code of the GoCD deploy pipeline ([`docs/design/deploy-workflow.md`](../../docs/design/deploy-workflow.md)). GoCD tasks call `aws` · `helm` · `kubectl` themselves; this package only decides (what to start, what to wait for, what counts as failure) and is called as `node dist/cli/<stage>.js`. It never runs against real AWS · k3s in tests: every external command goes through an injected runner (`Aws` in `src/aws.ts`) and tests pass fakes.

## Commands

Run in `Infra/pipeline/` (Node and pnpm as for BE):

| Task | Command |
| --- | --- |
| Install (CI-exact) | `pnpm install --frozen-lockfile` |
| Lint / typecheck / test | `pnpm lint` / `pnpm typecheck` / `pnpm test` |
| Verify (lint → test → build; run before every commit) | `pnpm verify` |

`src/chart.spec.ts` renders the chart with the real `helm` and compares `src/__snapshots__/chart-*.yaml`; it is skipped where `helm` is missing unless `CI` is set (GitHub's runner has helm). Tests also run `Infra/build/build.sh` with bash against fake `git` · `iptables` · `docker` · `aws` on `PATH`, and read `BE/src/deploys/deploy-condition.ts` to compare the default Dockerfile versions.

## Layout

| Path | What |
| --- | --- |
| `src/deploy-input.ts` | Deploy input types and the shape check of what the pipeline reads |
| `src/build.ts`, `src/cli/build.ts` | Build stage (W4): StartBuild per `run` service, BatchGetBuilds polling, digest, failure report |
| `../build/buildspec.yml`, `../build/build.sh` | The one buildspec every student build uses (passed inline) and the script it runs |
| `../build/dockerfiles/` | Default Dockerfiles per framework and `versions.json` (sha256 + version, checked by a test) |
| `src/render.ts`, `src/cli/render.ts` | Render stage (W5): quota × 2 check, chart values, `helm template` (slot part + open part), `kubectl apply --dry-run=server` |
| `src/helm.ts`, `src/kubectl.ts`, `src/exec.ts` | Thin runners for `helm` and `kubectl` (no shell) |
| `../charts/student-app/` | The student app chart; values come only from `renderValues()` |

## Pitfalls

- **A chart change shows up as a snapshot diff.** Regenerate with `pnpm exec vitest run -u src/chart.spec.ts` on a machine with helm and read the diff: it is the manifest every student deploy gets.
- **Changing a default Dockerfile needs a version bump.** Update `versions.json` (sha256, version) and `DEFAULT_DOCKERFILE_VERSIONS` in BE together, or the build cache keeps serving images built from the old file. `src/dockerfiles.spec.ts` fails until all three agree.
- **The sha256 is of the file as git stores it (LF line endings).** A hash computed on a Windows CRLF copy never matches; the root `.gitattributes` keeps `Infra/build/**` checked out as LF so a local hash is the same as CI's.
