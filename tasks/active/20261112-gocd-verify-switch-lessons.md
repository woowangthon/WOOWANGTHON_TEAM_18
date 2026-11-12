# Verify and Switch stages in the student-deploy pipeline — lessons

## Log

- 2026-11-12: the user approved PR-E and the `student-trial` YAML in this window. Started PR-E on top of #141 (not yet merged). The Traefik egress the earlier plan listed as a task was already in `Infra/executor/agent.yaml`, so nothing changed there. `student-trial` was not started: its CLIs (trial input read, `trial-report`, `TRIAL_STAGES` filter) are not written; #148 is only the Switch `TRIAL_ID` guard and the Build override.

- 2026-11-12: after #141 was squash-merged, merged main again (the merged tree was the same as the #141 head already merged here, so every conflict took this branch's side). Review: suda pointed out that `platform-hosting.md` said Switch cleans up the old slot; Switch only applies the open Ingresses and removes leftover open Ingresses and Middlewares (`switch.ts` header), and the platform server scales the old slot to 0 after it records `live_slot` (W7). Fixed the row.

## Lessons

- What was checked here is the YAML being accepted by a real GoCD server and the job arguments matching the CLIs' usage; Verify and Switch have not run against the leader's Traefik and k3s from the pipeline. Do not read "the stages are defined" as "the switch path works": that needs the L2 run on the EC2 with the leader executor.
- When describing a stage, take its scope from the CLI's header comment, not from the stage's name: "Switch" does not include scaling down the old slot (that is the platform server's W7).
