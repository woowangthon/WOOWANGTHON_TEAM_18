# Deploy input schema and A/B slot deploy design

- **SRS**: none yet (SRS §4 has no FR for the deploy flow)
- **Owner**: suda5936
- **Branch**: docs/deploy-handoff-blue-green

## Plan

Fix the W3 → W4 deploy input JSON so W0~W3 can be built in parallel, then change the deploy design to two fixed slots (A, B) per service with one open Ingress per project, and verify the target slot through Traefik before switching. Docs only; code follows in a later PR.

## Todo

- [x] Deploy input schema (commitSha, deploy_condition, spec), fields, validation rules — files: `docs/design/deploy-handoff.md`
- [x] A/B slots: slot layout, DB rows, open Ingress, slot reset, shared Secret — files: `docs/design/deploy-workflow.md`
- [x] Traefik check of the target slot through the test Ingress before switching open — files: `docs/design/deploy-workflow.md`

## Done when

- [ ] W0~W3 owner can produce the deploy input from `deploy-handoff.md` alone
- [ ] `deploy-workflow.md` has no execution modes (full, promote, rollback, candidate) left
- [ ] relative links in the changed docs resolve
