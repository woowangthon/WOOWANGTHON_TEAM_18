# Deploy workflow design draft

- **SRS**: none (SRS UC/FR still empty; serves the deployer flow in system-definition §4.1)
- **Owner**: 현식 (suda5936)
- **Branch**: docs/deploy-workflow

## Plan

Write down the deploy workflow the team discussed as a design draft before any code: the platform server runs fixed steps W0–W7 in code, W4–W5 are one GoCD pipeline run (Build on AWS CodeBuild, Prepare/Render/Apply on the leader agent), W6 (verify) is done by the platform server itself outside GoCD, and an AI agent is called only when a step fails, linked by a problem ticket and a resolution. When the fix needs a change in the student repo, the agent opens a fix PR through the bot account (ADR-002) after the trial deploy passes. Includes where each LLM is used (local Qwen3-8B on the leader vLLM, a reasoning-model API for planning) and the AWS layout (one t3.large EC2).

It differs from system-definition §4.1 (AI review before every deploy, operator approval, platform DB; the bot PR stays but comes after a fix), so it lands as a `초안` design doc only. system-definition, ai-scope and the ADRs change in a follow-up PR after the team agrees; open points are listed in the doc's "정할 것".

## Todo

- [x] Design doc with terms, flow, W4–W6 mapping, manifest timing, problem ticket loop, model placement, layout, decisions and alternatives, pros/cons, follow-ups — files: `docs/design/deploy-workflow.md`
- [x] Diagram that draws W4–W6 once, as the pipeline — files: `docs/design/deploy-workflow.drawio.svg`

## Done when

- [ ] Team agrees or sends changes on the open points (operator approval, bot PR, GoCD owner, API model and budget, initial numbers)
- [ ] Follow-up PR updates system-definition §3 · §4.1, ai-scope and the new ADRs
- [x] Docs only; no tests or mutation testing apply
