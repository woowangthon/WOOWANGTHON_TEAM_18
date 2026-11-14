# TEST_3 live-test findings — lessons

## Log

- 2026-11-14: test repo `TaeTaeJin/WOOWANGTHON_TEST_3` (`e91dde7`) — a Node server that fails on purpose
  after `CHAOS_AFTER_SECONDS` (default 180 s): `CHAOS=crash` exits 1 (restart loop), `CHAOS=unready` makes
  `/api/health` answer 503 (not ready, no restart).
- 2026-11-14 crash (`woowangthon-test-3`, BE `0e0c3e6`): `KubePodCrashLooping` pending 08:00:54 → firing
  15 min later → 08:16:12 `incident opened` + `incident auto-stopped` in the same second → operator Discord
  "자동으로 멈췄어요" → Deployment 0/0 → alert gone, `resolved_at` 08:20:11. `ai.status: skipped`,
  `decided_by: rule`. Student banner did not show because the live FE was older than #205 (fixed by an FE deploy).
- 2026-11-14 unready (`woowangthon-test-3-second`, BE `5fe92e9`): `KubePodNotReady` and
  `KubeDeploymentReplicasMismatch` pending 08:57:54 → 09:13:14 two incidents opened → both judged by the
  local model (`model: local`, `status: done`) → operator and student Discord, 2 messages each → operator
  pressed "중지" twice (18:14:20, 18:14:23 KST) → both `stopped` → `resolved_at` 09:15:14. Student page showed
  "서비스를 멈췄어요" with the AI cause. Finding A comes from the two presses.
- 2026-11-14 AI judgment quality: a service whose public URL answered 503 for 15 min was judged
  "위험 낮음 · 지켜보기" (the evidence it cited was right). Accuracy is declared unverified in
  `docs/ai-scope.md` FR-079; not a code fix.
- 2026-11-14 PR scenario (`woowangthon-test-3-pr`, commit `a1ef288`, BE `5fe92e9`): deploy failed at apply
  (start-up `ENOENT`), ticket `t_87237592820e`, classified `A2 · code` (right), local model. 16 tool calls
  in 241 s: `read_pod_logs`; `run_deploy` / `run_render` / `run_build` with a specPatch adding env `CHAOS`
  (3× `INVALID_SPEC CONFLICT`, the test secret distracted it); `read_repo`; re-runs without a patch
  (`run_build`, `run_render`, `run_deploy` ok=False, `run_verify` ok=False); `edit_repo_file` 2×
  `EDIT_FORBIDDEN`, then `REPEATED_CALL`; `run_build` `TOOL_LIMIT` → `gave_up`. The bot fork was created
  (`wanggane-bot/TaeTaeJin_WOOWANGTHON_TEST_3`, 10:23:41, named `owner_name` as #206 intended) but no edit
  branch. No `GitHub ... failed` line in BE logs.
- 2026-11-14 why `EDIT_FORBIDDEN` (most likely, not proven): ran the gateway's own checks locally on the
  repo file. The right fix as whole-file content = 2 changed lines, no secret-looking line → accepted. Only
  the changed line as `content` → 52 removed lines → over the 50-line limit → refused. What the model sent
  is not logged anywhere (finding F13-3).
- 2026-11-14 no Discord for the failed deploy: by design today — only Prometheus incidents notify. The
  restart loop in the trial slot lasted ~4 min, short of the 15 min alert. Finding D.
- 2026-11-14 planning F13-1: `cases.json` A2 (crash on start) had only an env path, which explains why the
  agent reached for `CHAOS` first; B4 said "import 줄만", which reads as "send only the import line".
  Both now point to find/replace (finding F13-4).
- 2026-11-14 built A, F13-1..4 and D on #210 (automated tests only; live checks after merge and deploy).

## Lessons

- Start a fault after the deploy pipeline has switched, not at a fixed short delay: queue + stage gaps can
  exceed a few minutes. 180 s was enough on 2026-11-14 but is not a guarantee.
- A test secret the bug does not need distracts the agent. Fix-PR test repos should need no secrets.
- Live checks found what fake-GitHub/fake-GoCD tests could not: whole-file `content` is hard for an 8B model.
  Prefer tool shapes a small model can fill (find/replace) and log refusal kinds so the next failure is read,
  not guessed.
