# Student deploy explanation (AI)

- **SRS**: FR-105
- **Owner**: TBD
- **Branch**: claude/determined-cray-jq9nef

## Plan

After a deploy ends, BE asks the AI server once (no tools, strict structured output, `reasoning_effort`) to explain the stages, likely cause and next steps; result kept in BE memory, shown as `explanation` on the status read. Flag `DEPLOY_EXPLAIN_ENABLED`, default off. Design: `docs/design/deploy-explain.md`.

## Todo

- [x] docs: api.md, SRS FR-105, ai-scope row + limit, design/deploy-explain.md
- [x] AI: `agent/explain.py`, route `POST /agent/explanations`, `EXPLAIN_REASONING_EFFORT`, tests
- [x] BE: `deploys/deploy-explainer.ts`, hooks in `deploy-runs.service.ts`, flag in `env.ts`, tests
- [x] FE: `ExplainSection.tsx`, static stage guide, pending poll deadline, tests
- [ ] human: gateway smoke test with the production key, then set SSM `DEPLOY_EXPLAIN_ENABLED=true`
- [ ] Notion SRS: add FR-105 to match `docs/SRS.md`

## Done when

- [ ] smoke test 200 with a matching schema; flag on; one success and one student failure deploy show an AI explanation
- [x] tests added; mutation testing not run: no tool chosen
