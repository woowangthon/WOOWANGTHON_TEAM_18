# Verify and Switch stages in the student-deploy pipeline (PR-E, #135)

- **SRS**: FR-049 to FR-052, FR-056
- **Owner**: TaeTaeJin (with Claude Code)
- **Branch**: chore/gocd-verify-switch (stacked on `chore/gocd-pipeline`, PR #141; `git merge upstream/main` once #141 is squash-merged)

## Plan

The Verify and Switch CLIs are on main (#139). Add the two stages after Apply in `Infra/gocd/student-deploy.gocd.yaml`, the same job shape as the others (`clean` first, fetch, `setup`, the stage, `notify` with `run_if: any`), both on the leader executor.

- Verify fetches Build's `work/` and runs `verify work/deploy-input.built.json <slot> out`. Its requests go through Traefik; the executor NetworkPolicy already allows the Traefik Pods on port 8000 (`Infra/executor/agent.yaml`), so no policy change.
- Switch fetches Build's `work/` and Render's `out/` (for `open.yaml`) and runs `switch work/deploy-input.built.json <slot> out/open.yaml out`. A stage that fails stops the run, so Switch never follows a failed Verify.
- `student-deploy` never sets `TRIAL_ID`; the Switch CLI refuses a run that has it (#148).
- Not in this PR: the `student-trial` pipeline. It needs CLIs that exist nowhere yet (reading the trial input by `TRIAL_ID`, `trial-report`, the `TRIAL_STAGES` filter; #148 has only the Switch guard and the Build override).

## Todo

- [x] `job.sh`: `clean verify|switch`, `verify`, `switch`
- [x] YAML stages `verify`, `switch`; docs that said "PR-E" (platform-hosting, deploy-workflow §8, ai-scope)
- [x] Local check: stub `node`, the exact CLI arguments; YAML parsed by a real GoCD 26.1.0 server
- [ ] `/code-review low`, `/simplify`; draft PR (`Refs #135`)

## Done when

- [ ] Both stages parse on a real GoCD server with the task order above
- [ ] Not verified, said plainly in the PR body: Verify and Switch on a real cluster (needs the leader Pod and a built image)
