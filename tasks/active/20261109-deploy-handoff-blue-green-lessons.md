# Deploy input schema and A/B slot deploy design — lessons

## Log

- 2026-11-09: Deploy input fixed as commitSha + deploy_condition + spec. `deploy_condition.services` is always null from W0~W3; W4 fills it. No schemaVersion or specVersion. No deployId or attempt (attempt comes back with the agent).
- 2026-11-09: Deploy strategy: blue-green with fixed slots A and B, not rolling or canary. Slot values stay out of the deploy input; W4 and later own them. One Secret per service shared by both slots, because the platform server cannot read Secrets to copy them per slot.
- 2026-11-09: The target slot is checked through Traefik with a test Ingress that uses the same path rules as open, then open is switched. No post-switch check or automatic switch-back in the MVP.
- 2026-11-10: Agent design added to the same PR. The agent tests its own fix on the target slot through MCP gateway tools (run_build, run_render, run_deploy, run_verify) instead of returning a spec patch for the platform to rerun. It never writes YAML and gets no cluster, GoCD or bot credentials (ADR-012). Ticket input is a small envelope plus raw CodeBuild and k3s output; known errors go to long-term memory playbooks to save planning calls. Agent framework: PydanticAI.

## Lessons

