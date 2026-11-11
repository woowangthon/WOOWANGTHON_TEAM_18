# Verify and Switch stages (W6, switch)

- **SRS**: FR-055 (switch only after the check passes, live slot untouched on failure), FR-056 (failure reason to the student), FR-052 (apply to the cluster)
- **Owner**: suda5936
- **Branch**: feat/pipeline-verify-switch

## Plan

Two stage CLIs in `Infra/pipeline` on the k3s API with the executor role `proj-deployer` (#114). Verify: Pod Ready and EndpointSlices per service (AI → BE → FE), then for public services GET via Traefik (`TRAEFIK_URL`, default the Traefik Service) with Host `<slug>.test.internal`: static page plus up to 10 same-host scripts and stylesheets, server health path (with `ingressPath` in front when stripped, skipped when Traefik cannot reach it). 10 s per request, 3 tries 5 s apart. Report in the MCP `run_verify` shape. Student failure follows the merged ticket contract (#109): `raw.k8s` with the Pod of that service and slot events, status null, and an `errorMessage` that names the failed check with path and status (agent cases V1 · V2 match on it). Traefik unreachable is platform `TRAEFIK_UNREACHABLE`. Switch: apply `open.yaml`, delete open Ingresses not in it and Middlewares of services that no longer strip, scale the previous slot Deployments to 0 (merge patch); all platform failures; idempotent so an interrupted switch is finished by running it again. Not here: GoCD YAML, notify tasks, reconciling finished runs (F07).

## Todo

- [x] Verify — files: `src/verify.ts`, `src/cli/verify.ts`
- [x] Switch — files: `src/switch.ts`, `src/cli/switch.ts`
- [x] Share role order and slot-event filter — files: `src/apply.ts`
- [x] Docs — files: `docs/design/deploy-workflow.md`, `docs/ai-scope.md`, `Infra/pipeline/CLAUDE.md`

## Done when

- [ ] tests added and pass in the test session; hand-made mutants killed or explained
- [ ] Verify through the real Traefik and Switch on the leader k3s (not possible in this sandbox)
