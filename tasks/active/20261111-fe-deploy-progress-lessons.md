# FE deploy start, progress and result address screen (#99) — lessons

## Log

- 2026-11-11: Started from `upstream/main` 41a72aa. New worktree `WOOWANGTHON_TEAM_18_fe99`. SRS §3 says the progress fields are not decided and no #98 / #44 contract is in `api.md`, so only the stage display is built.
- 2026-11-11: `react-refresh/only-export-components` rejected the stage list exported from the component file; moved it to `deploy/stages.ts`.
- 2026-11-11: First version took `current` stage plus one `condition`. `/simplify` (altitude) showed that bakes in the unwritten #98 contract: "배포 대기" is a place between build and deploy, not an overlay; `done` + `fixing` was an allowed pair; "skipped" and a retry that moves back could not be drawn; and nothing used it yet. Rewrote it as a drawing-only component that takes one state per stage.
- 2026-11-11: `/code-review low`: one note, an unmapped `current` shows every stage as waiting. Not reachable through the types; it moves to the parent's mapping (todo). `/simplify`: also applied one status derived per row (now gone with the rewrite). Efficiency and reuse: nothing. Left: nothing.
- 2026-11-11: Hand mutants on the final component: 5 of 5 behaviour mutants killed (stage order, state words, which states are marked current); a style-only class mutant survives by design.
- 2026-11-11: The contract for #44 / #98 arrived (BE commit 03685bb, docs only; endpoints not written). Built the whole issue against it on this branch: server step keys replace my own stage keys, `stageStatesOf`, `DeployProgress` with polling, start and failure views, the my-deploys list, routes and links. `pnpm verify` exit 0 (346 tests).
- 2026-11-11: Hand mutants on the polling, start and mapping logic: 13 tried, 11 killed at first. The two survivors were real gaps: "already started" shown as an error was hidden only because the next read changed the screen, and an old start failure stayed up while the user retried. Added a test for each; both mutants are now killed.
- 2026-11-11: Test pitfalls: a mock that counts calls to the same function it is answering sees its own call (use `<= 1` for "first"); a lookup by label prefix finds "배포 설정" before "배포" (match the name cell exactly).
- 2026-11-11: `/code-review low` on the implementation: real — the screen kept the old deploy's state and start button when the id changed (fixed with `key={id}` on the page) and every read error was retried forever with a "not your fault" line (now only 503 and network errors retry; others stop and offer "다시 읽기"). Left: an empty alert body if the server sent `fixing` / `needs_user` without `failure` (the contract says it is never null).
- 2026-11-11: `/simplify` on the implementation: real — `failure.stage` is a pipeline word (apply, prepare…), not a step name, so the label is now taken from the step marked failed; `useCopy` shared with `CommitRef`; `StatusBadge`; list page conditions merged; test helpers. Left: a shared polling hook, back-off and tab-hidden pause, `updatedAt` comparison, a copy table for the start alerts (see the todo).
- 2026-11-11: The BE answered the three gaps (see the todo): missing items come as `error.fields`, warnings are `{ code, message, service }`, `{}` is accepted. Added the missing list and the warning box; hand mutants: 7 tried, 6 killed, the survivor (stage word fallback) got a test and is killed.
- 2026-11-11: Not checked: a browser, the real endpoints (not implemented yet; start answers 503 NOT_IMPLEMENTED until #82 lands), screenshots, mutation tool (#67).

## Lessons

<fill when done>
