# Agent: BE MCP gateway — lessons

## Log

- 2026-11-11: The run tools need the pipeline to run one stage on the target slot with a spec patch; it only takes `DEPLOY_ID` today. Opening them would have meant faked results, so the user chose to list only the observation tools and `submit_result` (F11b adds the rest).
- 2026-11-11: Events carry no `slot` label. The gateway keeps only events whose object is a target-slot Pod or Deployment (or a ReplicaSet named after it).

## Lessons

- A tool that cannot be backed by a real action is better left out of the tool list than answered with a stub; the agent then cannot claim it ran.
