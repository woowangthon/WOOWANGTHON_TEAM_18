# Student app chart and Render stage (W5)

- **SRS**: FR-049~058 (UC-07 build, deploy, check)
- **Owner**: suda5936
- **Branch**: feat/student-app-chart

## Plan

`Infra/charts/student-app` renders, per slot, a Deployment · Service · ConfigMap per service (`<name>-<slot>`, labels `app` · `slot`), plus one test Ingress (part `slot`) or one open Ingress (part `open`) with every public path; Ingresses carry no slot label so slot cleanup never removes them. All judgement is in `Infra/pipeline/src/render.ts`: values from the deploy input (probes from `runtime.health`, default resources incl. ephemeral storage, same-slot link URLs, secret keys from `<name>-secrets`, `secretHash` as a Pod annotation), the quota × 2 check first, then `helm template` and `kubectl apply --dry-run=server` behind one function each. Pending user decisions: how to keep the raw k3s Status of a dry-run failure (kubectl prints only text), and `stripPrefix` (needs a Traefik Middleware and executor RBAC), which the chart refuses for now. Design: `docs/design/deploy-workflow.md` §3 · §4, `docs/design/deploy-handoff.md`, `docs/design/cluster.md` §6 · §8.

## Todo

- [x] Chart — files: `Infra/charts/student-app/*`
- [x] Values, quota check (CPU, memory, ephemeral storage, Pods), Render flow — files: `Infra/pipeline/src/render.ts`
- [x] helm / kubectl runners and the CLI — files: `src/helm.ts`, `src/kubectl.ts`, `src/exec.ts`, `src/cli/render.ts`
- [x] Slug 1~40 and service name 1~30 in the pipeline's input check (#97) — files: `src/deploy-input.ts`
- [x] Docs — files: `docs/design/deploy-workflow.md`, `docs/design/deploy-handoff.md`, `docs/ai-scope.md`, `Infra/pipeline/CLAUDE.md`
- [ ] Dry-run Status raw (waiting for the user's answer)
- [ ] `stripPrefix` (waiting for the user's answer)

## Done when

- [x] rendered manifests pass server dry run on a k3s with the student space and the admission policies; both slots fit the quota
- [x] tests added; hand-made mutants killed or explained
- [ ] the leader's k3s accepts a render (needs the executor account, build 09′)
