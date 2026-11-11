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
- 2026-11-11: Not checked: a browser, a real BE, screenshots, mutation tool (#67). The component is not mounted on any route.

## Lessons

<fill when done>
