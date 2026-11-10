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
- [x] AI agent design: ticket in (envelope + raw CodeBuild/k3s output + 10-minute logs), result out, close notice, tools through the MCP gateway, allowed and forbidden actions, long-term memory cases, diagram — files: `docs/design/AIagent.md`, `docs/architecture/agent-flow.drawio.svg`
- [x] Deploy workflow §6: the agent tests fixes on the target slot itself; the platform re-verifies, then runs Switch and W7 — files: `docs/design/deploy-workflow.md`
- [x] ADR-012: the agent acts only through the platform gateway — files: `docs/adr/012-agent-acts-through-platform-gateway.md`, `docs/system-definition.md`
- [ ] Agent framework PydanticAI instead of LangChain — files: `docs/ai-scope.md`, `docs/system-definition.md`

## Done when

- [ ] W0~W3 owner can produce the deploy input from `deploy-handoff.md` alone
- [x] `deploy-workflow.md` has no execution modes (full, promote, rollback, candidate) left; the only pipeline option is the fix-PR check (fork source, no Switch)
- [x] relative links in the changed docs resolve
