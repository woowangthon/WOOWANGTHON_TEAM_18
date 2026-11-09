# Deploy workflow design draft — lessons

## Log

- 2026-11-06: Iterated the workflow with Claude Code (diagram v7 → v15): separated the fixed workflow from the AI agent, added rollback-first, the problem ticket / resolution contract, and the trial deploy.
- 2026-11-06: Build moved back to AWS CodeBuild (ADR-001); GoCD runs on two agents (AWS for Build, leader for the rest); manifests are rendered per deploy with our Helm chart.
- 2026-11-07: Local model changed to Qwen3-8B (AWQ, 16k on the RTX 3080); planning uses a reasoning-model API. AWS consolidated to one t3.large EC2 (8GB; GoCD alone takes 1–2GB). Diagram redrawn so W4–W6 appear once, as the pipeline.
- 2026-11-07: The message queue is left out of this design (현식). When the agent has to change files in the student repo, it opens a fix PR through the bot account (ADR-002) after the trial deploy passes; the user merges, and the new commit redeploys. Issue #29 (agents on every worker) updated with this resolution and closed.
- 2026-11-09: Diagram review: the GoCD pipeline box sat inside the platform-server lane, so W5 read as running on the backend. Colored the stages by where they run (AWS box for Build, leader-node box for Prepare to Report, the same purple as the leader below) and said in the lane title that GoCD runs W4–W6.
- 2026-11-09: W6 (verify) and the result report moved out of GoCD to the platform server (현식): judging a deploy belongs to whoever owns the workflow, so verdict, rollback and the problem ticket sit in one place. The pipeline now ends at Apply; the server reads results and logs through the GoCD API, checks Pod Ready / Endpoints through the leader k8s API over Tailscale, and runs `rollback` mode on failure. The `verify_only` mode is gone. Open point 6: how the server reaches the app pages, since trial deploys have no public address.

## Lessons

- Drawing W4–W6 both as workflow steps and as pipeline stages made readers think they ran twice. Draw a step that is "one run of another tool" once, as that tool, and label the grouping.
- `--max-model-len` is a VRAM choice, not the model's limit (Qwen3-8B takes 32k). Say which one a number is.
