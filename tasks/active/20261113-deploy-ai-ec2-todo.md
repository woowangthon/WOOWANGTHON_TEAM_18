# Deploy the AI server on the platform EC2

- **SRS**: UC-14 (P0) — the agent has to run somewhere the platform server can reach
- **Owner**: track B (AI agent)
- **Branch**: feat/deploy-ai-ec2 (from team `main` 7b79bba)

## Plan

- `Infra/aws/deploy-ai.sh`, the same shape as `deploy-be.sh`: SSM `${SSM_PATH:-/wcp/ai}` → `~/.config/wcp/ai.env` (multi-line values refused), stop before the build without `AGENT_API_TOKEN` or `GATEWAY_URL`, build `git archive ref:AI`, run `wcp-ai` (`--restart unless-stopped`, `-p 127.0.0.1:8000:8000`), health `/health`, roll back to the previous container on failure. No Trivy step.
- A user-defined docker network `wcp` for `wcp-be` and `wcp-ai`: `deploy-be.sh` only gains the network creation and `--network wcp`. BE `AI_SERVER_URL=http://wcp-ai:8000`, AI `GATEWAY_URL=http://wcp-be:<GATEWAY_PORT>/mcp`; the gateway port is not published.
- Out of scope: models (vLLM, planner API), BE · AI code, GoCD and the leader.

## Todo

- [x] Scripts — files: `Infra/aws/deploy-ai.sh`, `Infra/aws/deploy-be.sh`
- [x] Docs — files: `docs/design/platform-hosting.md` ("AI 서버"), `docs/ai-scope.md`
- [x] Local rehearsal with docker (fake SSM through a fake `aws`, fake values kept out of git)

## Done when

- [ ] `bash -n` and shellcheck on both scripts — from the test session
- [x] Local: both containers on `wcp`; AI `/health` 200; `wcp-ai` → `wcp-be:<GATEWAY_PORT>/mcp` answers (400 for an empty JSON-RPC body); `wcp-be` → `wcp-ai:8000/health` 200; gateway port not on the host; missing `GATEWAY_URL` stops before the build; a bad token rolls back to the previous container; a BE redeploy keeps the AI reaching it
- [ ] Real EC2 — by the user (not verified here)
