# GoCD pipeline definition, local docker stack and EC2 start script (#135, PR-C)

- **SRS**: FR-049 to FR-052, FR-056
- **Owner**: TaeTaeJin (with Claude Code)
- **Branch**: chore/gocd-pipeline (stacked on PR-A `feat/pipeline-glue` once it exists; until then from `upstream/main`)

## Plan

The stage CLIs (`Infra/pipeline`) and the platform server side (`BE/src/deploys/pipeline.*`) exist. What is missing is GoCD itself: the pipeline definition, a server and agents to run it, and the script that starts it on the EC2. Design: [ADR-009](../../docs/adr/009-deploy-runs-on-leader-gocd-agent.md), [deploy-workflow §1 · §2 · §6 · §8](../../docs/design/deploy-workflow.md), [platform-hosting](../../docs/design/platform-hosting.md), the leader agent Pod `Infra/executor/agent.yaml`.

- `Infra/gocd/student-deploy.gocd.yaml` (GoCD YAML config repo): pipeline `student-deploy`, stages Build (resource `aws`) → Prepare → Render → Apply (resource `leader`). The first stage needs manual approval, so a commit never starts it (the material keeps default polling: GoCD refuses a material whose autoUpdate differs from its config repo's); only the platform server's schedule call does (`BE/src/deploys/pipeline.client.ts`, variable `DEPLOY_ID`, `update_materials_before_scheduling`). No Verify / Switch stage yet: those CLIs are not written, and a stage calling a missing CLI would report a fake verify failure on every run.
- Every job is the same shape, `Infra/gocd/job.sh <step>` per task: `setup` (install + build `Infra/pipeline`), the stage, then `notify` with `run_if: any` (PR-A's `notify` sends `STAGE_NO_REPORT` when no report file exists, so one task covers success and every kind of failure).
- One input per run: only the Build job calls `fetch-input` (the GET input has no images). Build writes `work/` (input, slot, build report, `deploy-input.built.json` = `report.input`) and publishes it; Prepare, Render and Apply fetch it. Apply also fetches Render's `out/slot.yaml`.
- Secrets are never in the YAML: `PIPELINE_NOTIFY_TOKEN` and the AWS key are the agents' own environment (compose for the AWS agent, the Secret `gocd-agent` for the leader Pod). GoCD cannot give a config-repo pipeline a secure variable (an environment in the server's config may not reference it, 422 on the real server) and its secret-manager plugin is not bundled.
- `Infra/gocd/compose.yaml` (server `gocd/gocd-server:v26.1.0` with `-Xmx1g`, AWS agent, and a local-test-only leader-role agent behind a profile), `aws-agent.Dockerfile`, `local-leader-agent.Dockerfile`.
- `Infra/gocd/setup.sh`: file-based auth, config repo, BE's access token, the agent auto-register key and the leader Secret file. Same script locally and on the EC2.
- `Infra/aws/start-gocd.sh`: reads `/wcp/gocd/*` from SSM like `deploy-be.sh`, starts the server, runs `setup.sh`, starts the AWS agent.
- Docs: `platform-hosting.md` (GoCD section, AWS resources the user creates, `/wcp/be/*` additions), `deploy-workflow.md` (§1 sentence, §8 row), `docs/ai-scope.md` GoCD row.

Decisions:
- Notify is the only way the server learns a result (api.md "파이프라인 ↔ 플랫폼 서버"), so `deploy-workflow.md` §1's "GoCD API로 … 결과와 로그를 받고" is wrong and is fixed.
- The leader agent's cluster credentials stay in `Infra/executor/agent.yaml`; the local-test agent only mounts a token file and CA and must never run next to the real one.
- GoCD's secret-management plugin is not bundled with the server, so secure environment variables are used instead of a plugin.

## Todo

- [x] Read the design docs, the agent Pod, the SSM script pattern and the CLI usage lines
- [x] `Infra/gocd/job.sh`, `student-deploy.gocd.yaml`
- [x] `Infra/gocd/compose.yaml`, `aws-agent.Dockerfile`, `local-leader-agent.Dockerfile`
- [x] `Infra/gocd/setup.sh`
- [x] `Infra/aws/start-gocd.sh`
- [x] Docs: `platform-hosting.md`, `deploy-workflow.md`, `docs/ai-scope.md`
- [x] Local check L1 (below), recorded in the PR body
- [ ] `/code-review low`, `/simplify`; rebase onto `upstream/main` after PR-A merges
- [ ] Draft PR (`Refs #135`)

## Done when

- [ ] L1: local BE with `GOCD_URL` and the token from `setup.sh`, start a deploy; GoCD runs; the AWS agent reads the input from the BE; Build fails as a platform failure (the CodeBuild project does not exist yet); the BE run is `failed` with that platform code; the job logs show no token; test rows removed afterwards
- [ ] `docs/ai-scope.md` says what is built and what is unverified (the leader agent, the EC2 start, a real build and Apply)
- [ ] Not verified, said plainly in the PR body: the EC2 script on a real EC2, the leader agent registering, a real CodeBuild / Apply run
