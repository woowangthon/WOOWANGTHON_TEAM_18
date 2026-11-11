# Student app chart and Render stage (W5)

- **SRS**: FR-049~058 (UC-07 build, deploy, check)
- **Owner**: suda5936
- **Branch**: feat/student-app-chart

## Plan

`Infra/charts/student-app` renders, per slot, a Deployment · Service · ConfigMap per service (`<name>-<slot>`, labels `app` · `slot`), plus one test Ingress per public service (part `slot`, `test-<name>`) or one open Ingress per public service (part `open`, `open-<name>`), and a Traefik Middleware `<name>-strip` for a service with `stripPrefix`; Ingresses and Middlewares carry no slot label so slot cleanup never removes them. All judgement is in `Infra/pipeline/src/render.ts`: values from the deploy input (probes from `runtime.health`, default resources incl. ephemeral storage, same-slot link URLs, secret keys from `<name>-secrets`, `secretHash` as a Pod annotation), the quota × 2 check first, then `helm template` and a server-side apply dry-run per object through the k3s API, each behind one function. User decisions (2026-11-11): the dry-run calls the k3s API directly (server-side apply per object) so the raw Status survives; `stripPrefix` gets a Middleware `<name>-strip`; one Ingress per public service (`open-<name>` / `test-<name>`) because a Traefik middleware applies to every path of its Ingress. Design: `docs/design/deploy-workflow.md` §3 · §4, `docs/design/deploy-handoff.md`, `docs/design/cluster.md` §6 · §8.

## Todo

- [x] Chart — files: `Infra/charts/student-app/*`
- [x] Values, quota check (CPU, memory, ephemeral storage, Pods), Render flow — files: `Infra/pipeline/src/render.ts`
- [x] helm / kubectl runners and the CLI — files: `src/helm.ts`, `src/kubectl.ts`, `src/exec.ts`, `src/cli/render.ts`
- [x] Slug 1~40 and service name 1~30 in the pipeline's input check (#97) — files: `src/deploy-input.ts`
- [x] Docs — files: `docs/design/deploy-workflow.md`, `docs/design/deploy-handoff.md`, `docs/ai-scope.md`, `Infra/pipeline/CLAUDE.md`
- [x] Dry-run through the k3s API (server-side apply, raw Status kept) — user decision 1a — files: `src/kube.ts`
- [x] `stripPrefix` with a Traefik Middleware per service, one Ingress per public service — user decisions 2a · 3a — files: `templates/ingress.yaml` (the executor RBAC for Middlewares is in #114, `docs/design/cluster.md` §8)

## Done when

- [x] rendered manifests pass server dry run on a k3s with the student space and the admission policies; both slots fit the quota
- [x] tests added; hand-made mutants killed or explained
- [ ] the leader's k3s accepts a render (needs the executor account, build 09′)
