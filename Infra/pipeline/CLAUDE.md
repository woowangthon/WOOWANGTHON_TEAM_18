# Infra/pipeline/CLAUDE.md

The root [`CLAUDE.md`](../../CLAUDE.md) rules apply; this file adds the commands and layout of `Infra/pipeline/`.

The judgement code of the GoCD deploy pipeline ([`docs/design/deploy-workflow.md`](../../docs/design/deploy-workflow.md)). GoCD tasks call `aws` · `helm` themselves; this package only decides (what to start, what to wait for, what counts as failure) and is called as `node dist/cli/<stage>.js`. Render, Prepare, Apply, Verify and Switch call the k3s API directly (`src/kube.ts`, server-side apply) instead of kubectl, because kubectl prints only "Error from server" text and the agent ticket needs the raw k3s Status. Connection settings come from env: `KUBE_API_URL` is the API address (`https://<leader>:6443`); `KUBE_TOKEN_FILE` and `KUBE_CA_FILE` are file paths, so the token never sits in an env value. It never runs against real AWS · k3s in tests: every external call goes through an injected runner (`Aws` in `src/aws.ts`, `KubeCall` in `src/kube.ts`) and tests pass fakes (`src/kube-fake.ts`) or a loopback HTTP server.

## Commands

Run in `Infra/pipeline/` (Node and pnpm as for BE):

| Task | Command |
| --- | --- |
| Install (CI-exact) | `pnpm install --frozen-lockfile` |
| Lint / typecheck / test | `pnpm lint` / `pnpm typecheck` / `pnpm test` |
| Verify (lint → test → build; run before every commit) | `pnpm verify` |

`src/chart.spec.ts` renders the chart with the real `helm` and compares `src/__snapshots__/chart-*.yaml`; it is skipped where `helm` is missing unless `CI` is set (GitHub's runner has helm). Tests also run `Infra/build/build.sh` with bash against fake `git` · `iptables` · `docker` · `aws` on `PATH`, and read `BE/src/deploys/deploy-condition.ts` to compare the default Dockerfile versions. `src/notify.spec.ts` imports BE's `validateNotice` and checks that every body the mapper makes passes it; `src/platform-fake.ts` is the loopback platform server the glue tests use.

## Layout

| Path | What |
| --- | --- |
| `src/deploy-input.ts` | Deploy input types and the shape check of what the pipeline reads |
| `src/build.ts`, `src/cli/build.ts` | Build stage (W4): StartBuild per `run` service, BatchGetBuilds polling, digest, failure report |
| `../build/buildspec.yml`, `../build/build.sh` | The one buildspec every student build uses (passed inline) and the script it runs |
| `../build/dockerfiles/` | Default Dockerfiles per framework and `versions.json` (sha256 + version, checked by a test) |
| `src/render.ts`, `src/cli/render.ts` | Render stage (W5): chart values, `helm template` (slot part + open part), server-side apply dry-run per object |
| `checkQuota` in `src/render.ts` | Quota × 2 check; Prepare (F04) calls it, a failure is ticket stage `prepare` (case P2), not render |
| `src/prepare.ts`, `src/cli/prepare.ts` | Prepare stage (W5): live slot protection, quota check, clear the target slot by label, drop stale test Ingresses |
| `src/apply.ts`, `src/cli/apply.ts` | Apply stage (W5): server-side apply AI → BE → FE, Ready wait with fast-fail signals, failed Pod and slot events in the report |
| `src/platform-api.ts` | Client of the platform server's machine API (`PLATFORM_API_URL` https or loopback http, `PIPELINE_NOTIFY_TOKEN` in the header only, 10 s per call, retries 503 and connection failures 1 s / 2 s / 4 s) and the CLI exit codes (1 = the server answered 4xx, 2 = anything else) |
| `src/fetch-input.ts`, `src/cli/fetch-input.ts` | First task of the Build job: `GET /api/pipeline/deploys/$DEPLOY_ID/input`, check it with `parseDeployInput`, write `deploy-input.json` and `slot` (`a`/`b`, no newline) |
| `src/notify.ts`, `src/cli/notify.ts` | Notify task (`run_if: any`): turn a stage report (`BuildReport`, or `{ ok, failure }` of prepare · render · apply · verify · switch) into the `POST /api/pipeline/notify` body and send it. Several failed services: a platform failure first, else the first student failure. A report that is missing, not JSON or of the wrong shape is sent as platform code `STAGE_NO_REPORT` (the reason goes in the message) |
| `src/verify.ts`, `src/cli/verify.ts` | Verify stage (W6): Pod Ready and EndpointSlices per service, then GET via Traefik with Host `<slug>.test.internal` (`TRAEFIK_URL`); result in the MCP `run_verify` shape |
| `src/switch.ts`, `src/cli/switch.ts` | Switch: apply `open.yaml`, drop stale open Ingresses and Middlewares; safe to rerun. Scaling the previous slot to 0 is the platform server's (W7), not Switch's |
| `src/failure.ts` | Stage failure shape: `platform` (a code, no agent) or `student` (ticket `raw.k8s`); which k3s refusals are platform problems |
| `src/kube.ts` | k3s API client (node:https + cluster CA, 10 s per call, `K8S_TIMEOUT` / `K8S_UNREACHABLE`), splitting the chart output into objects, server-side apply |
| `src/helm.ts`, `src/exec.ts` | Thin runner for `helm` (no shell) |
| `../charts/student-app/` | The student app chart; values come only from `renderValues()` |

## Pitfalls

- **The manifest splitter reads only this chart's output.** `splitManifest` finds `apiVersion` · `kind` and the `name` right under `metadata:` with patterns, not a YAML parser (no new dependency). Keep `name` the first key of `metadata` in every template, and add a kind to `RESOURCES` in `src/kube.ts` when the chart gains one.
- **A chart change shows up as a snapshot diff.** Regenerate with `pnpm exec vitest run -u src/chart.spec.ts` on a machine with helm and read the diff: it is the manifest every student deploy gets.
- **Changing a default Dockerfile needs a version bump.** Update `versions.json` (sha256, version) and `DEFAULT_DOCKERFILE_VERSIONS` in BE together, or the build cache keeps serving images built from the old file. `src/dockerfiles.spec.ts` fails until all three agree.
- **The sha256 is of the file as git stores it (LF line endings).** A hash computed on a Windows CRLF copy never matches; the root `.gitattributes` keeps `Infra/build/**` checked out as LF so a local hash is the same as CI's.
