# AI agent performance pass — lessons

## Log

- 2026-11-14: checked the perf note against the code. Confirmed: B1–B5 playbooks name `read_build_logs`, B1/B4 `edit_repo_file`/`open_pr` (none exist in `BE/src/gateway/tools.ts`); prompt allows name/slug patches the gateway always rejects; `verified` specPatch must deep-equal the trial input; B2 regex matches the npm `EBADENGINE` warning. Also found `TOOL_LIMIT` is a stop code (no replan), and 6 of 44 vLLM requests so far ended with `finished_reason=length`.
- 2026-11-14: R1 cannot happen on the live service: `SERVICE_NAME` (`BE/src/deploys/deploy-input.ts`) already rejects names a k8s label would reject, so R1 is covered by unit tests only.

## Lessons

