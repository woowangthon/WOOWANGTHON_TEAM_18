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

Tests also run `Infra/build/build.sh` with bash against fake `git` · `iptables` · `docker` · `aws` on `PATH`, and read `BE/src/deploys/deploy-condition.ts` to compare the default Dockerfile versions.

## Layout

| Path | What |
| --- | --- |
| `src/deploy-input.ts` | Deploy input types and the shape check of what the pipeline reads |
| `src/build.ts`, `src/cli/build.ts` | Build stage (W4): StartBuild per `run` service, BatchGetBuilds polling, digest, failure report |
| `../build/buildspec.yml`, `../build/build.sh` | The one buildspec every student build uses (passed inline) and the script it runs |
| `../build/dockerfiles/` | Default Dockerfiles per framework and `versions.json` (sha256 + version, checked by a test) |

## Pitfalls

- **Changing a default Dockerfile needs a version bump.** Update `versions.json` (sha256, version) and `DEFAULT_DOCKERFILE_VERSIONS` in BE together, or the build cache keeps serving images built from the old file. `src/dockerfiles.spec.ts` fails until all three agree.
