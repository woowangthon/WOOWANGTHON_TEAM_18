# GoCD pipeline definition, local docker stack and EC2 start script — lessons

## Log

- 2026-11-11: started from the coordinating session's proposal, after the user approved it in this window. PR-A (`fetch-input` / `notify` CLIs) has no code yet, so the YAML follows the usage the coordinating session fixed: `fetch-input <out-dir>` (env `DEPLOY_ID`, `PLATFORM_API_URL`, `PIPELINE_NOTIFY_TOKEN`; writes `deploy-input.json` and `slot`), `notify <stage> <report.json>` (sends `STAGE_NO_REPORT` when the file is missing). AWS names fixed by the user: CodeBuild project `student-apps` (Seoul), log group `/aws/codebuild/student-apps`, GHCR secret `wcp/codebuild/GHCR_TOKEN`, IAM user `wcp-gocd-aws-agent`, SSM `/wcp/gocd/AWS_ACCESS_KEY_ID` · `AWS_SECRET_ACCESS_KEY`. The bot account name (`GHCR_USER`, `IMAGE_REPO`) is not known yet and stays a placeholder.

## Lessons

<filled when done: what surprised us, what to do differently; mark anything worth promoting to CLAUDE.md Pitfalls or docs/conventions.md>
