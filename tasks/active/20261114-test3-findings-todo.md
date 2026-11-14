# TEST_3 live-test findings: incidents one-stop, edit_repo_file for small models, deploy result to Discord

- **SRS**: FR-077 (fix PR), FR-078 / FR-079 (incidents)
- **Owner**: ops session (TaeTaeJin decided on 2026-11-14 that the ops session builds it; 현식 re-runs the PR scenario)
- **Branch**: `docs/ops-test3-findings` (#210)

## Plan

The ops session ran the live platform (BE/AI `5fe92e9`, FE `5c7e72a`) against the test repo
[`TaeTaeJin/WOOWANGTHON_TEST_3`](https://github.com/TaeTaeJin/WOOWANGTHON_TEST_3) on 2026-11-14.
Auto-stop and AI judgment worked end to end. The fix-PR path (F13) gave up before any commit.
Evidence and timings are in the lessons file next to this one. Each item below is small and independent;
All items were confirmed by TaeTaeJin on 2026-11-14.

- **A — stop closes the whole project.** One project raised two alerts at once
  (`KubePodNotReady` + `KubeDeploymentReplicasMismatch`) and the operator had to press "중지" twice.
  Worse, an operator could dismiss one and then stop on the other. Stopping is project-wide (all
  Deployments to 0), so the decision should be too.
  - Operator stop (`AdminIncidentsController` stop): after the claim succeeds and `stopProject` is `all`,
    set every other incident of the same slug with `resolved_at is null` and `action = pending` to
    `stopped` with the same `decided_by` / `decided_at`. Conditional PATCH (`action=eq.pending`) so a
    parallel decision still wins once.
  - Auto-stop (`AlertWatcher.autoStop`, `all`): same, with `auto_stopped` / `decided_by: rule`.
  - Dismiss stays per incident (a different alert may be a different cause).
  - Not in scope: merging alerts into one incident (schema + AI input + FE card change). Two Discord
    messages per project remain.
- **F13-1 — `edit_repo_file` takes find/replace.** The local model (Qwen3-8B) almost certainly sent only the
  changed line as `content`; the gateway reads `content` as the whole file, so the edit "removed" 52 lines
  and hit the 50-line limit (`EDIT_FORBIDDEN`, twice, then `REPEATED_CALL`). Add an alternative file
  shape `{ path, find, replace }`: `find` must occur exactly once in the ticket commit's file (else
  `INVALID_ARGUMENT` saying how many times it occurs). The gateway builds the whole new content and runs
  every existing check unchanged (5 files, 50 lines, secrets, paths, size). Keep `{ path, content }`.
  Contract first: `docs/design/api.md` "레포 수정(F13)", `docs/design/AIagent.md` §3, the AI prompt
  (`AI/ai_server/agent/prompts.py`: prefer find/replace for small fixes), the MCP tool schema in
  `BE/src/gateway/tools.ts`.
- **F13-2 — say why the line limit refused.** The 50-line refusal should say how many lines the request
  removes and adds, and that `content` is the whole file (or to use find/replace).
- **F13-3 — log the refusal kind.** Nothing recorded why `EDIT_FORBIDDEN` happened (the AI trace keeps
  only the code). Log the kind in BE (`edit refused: line limit | secret | path | size | not text |
  files`), no paths or values.
- **D — deploy result to the student's Discord.** A failed deploy (agent `gave_up`) sent nothing; only
  Prometheus incidents go to Discord today. When a deploy run ends (`succeeded`, `failed`, `needs_user`
  with the PR link or the request), send one line to the owner's `user_webhooks` URL with
  `DiscordNotifier.toStudent`. Not to the operator channel (too many deploys).
  Built as: `DeploysStore.updateRun` emits `DeployEvents.ended` when it really moved a run to an end
  status (one place instead of the ~9 writers); `DeployResultNotifier` reads the run and sends.
- **F13-4 — the A2 playbook had no code path** (found while planning). A2 (crash on start) only added a
  missing env, so the agent tried env first. Add a code-fix path (`ENOENT` / `Cannot find module` →
  `read_repo` → `edit_repo_file` find/replace → `run_build` / `run_deploy` / `run_verify` with the same
  `source` → `open_pr`, `needs_user` on `BOT_UNAVAILABLE` / `patchAttached`). B4 said "import 줄만", which
  invited a changed-line-only `content`; it now says find/replace.

## Todo

- [x] A — files: `BE/src/incidents/incidents.controller.ts`, `alert-watcher.ts`, `incidents.store.ts`, `BE/test/incidents.e2e.spec.ts`, `docs/design/incidents.md`
- [x] F13-1 — files: `BE/src/gateway/repo-edits.ts`, `tools.ts`, specs, `BE/test/gateway-edit.e2e.spec.ts`, `AI/ai_server/agent/prompts.py`, `AI/tests/test_agent_loop.py`, `docs/design/api.md`, `docs/design/AIagent.md`
- [x] F13-2 — files: `BE/src/gateway/repo-edits.ts` + spec
- [x] F13-3 — files: `BE/src/gateway/repo-edits.ts` (or `tools.ts`) + spec
- [x] D — files: `BE/src/deploys/deploy-events.ts`, `deploys.store.ts`, `BE/src/incidents/deploy-result.notifier.ts` + specs, e2e, `docs/design/incidents.md`, `docs/ai-scope.md`
- [x] F13-4 — files: `AI/ai_server/agent/cases.json`, `AI/tests/test_memory.py`, `docs/design/AIagent.md`

## Done when

- [x] A (automated tests): one "중지" on a project with two pending alerts leaves both `stopped`; auto-stop closes the other pending alerts of that project as `auto_stopped`
- [ ] F13-1: re-run the TEST_3 PR scenario (below) and the bot opens a PR on `TaeTaeJin/WOOWANGTHON_TEST_3`
- [ ] D: the failed and the PR-opened deploy each send one line to the student webhook
- [ ] tests added; mutation survivors resolved or explained

### Re-running the PR scenario

`TaeTaeJin/WOOWANGTHON_TEST_3` main is `a1ef288`: `server.js` reads `public/Index.html` (the file is
`index.html`), so the server dies at start with `ENOENT`. Deploy it as a new project with **no secrets**
(the `CHAOS` secret distracted the agent: it spent 3 calls adding `CHAOS` as a plain env, refused with
`CONFLICT`). Settings: service `chaos-test`, port `8080`, http `/api/health`, startup 60, public `/`.
The expected fix is one line in `server.js` (2 changed lines). Each run creates a new bot fork branch;
the fork `wanggane-bot/TaeTaeJin_WOOWANGTHON_TEST_3` already exists.
