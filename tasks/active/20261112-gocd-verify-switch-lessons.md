# Verify and Switch stages in the student-deploy pipeline — lessons

## Log

- 2026-11-12: the user approved PR-E and the `student-trial` YAML in this window. Started PR-E on top of #141 (not yet merged). The Traefik egress the earlier plan listed as a task was already in `Infra/executor/agent.yaml`, so nothing changed there. `student-trial` was not started: its CLIs (trial input read, `trial-report`, `TRIAL_STAGES` filter) are not written; #148 is only the Switch `TRIAL_ID` guard and the Build override.

## Lessons

<filled when done>
