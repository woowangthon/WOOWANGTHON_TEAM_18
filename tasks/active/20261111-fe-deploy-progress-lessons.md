# FE deploy start, progress and result address screen (#99) — lessons

## Log

- 2026-11-11: Started from `upstream/main` 41a72aa. New worktree `WOOWANGTHON_TEAM_18_fe99`. SRS §3 says the progress fields are not decided and no #98 / #44 contract is in `api.md`, so only the stage display is built.
- 2026-11-11: `react-refresh/only-export-components` rejected the stage list exported from the component file; moved it to `deploy/stages.ts`.
- 2026-11-11: Hand mutants on the stage logic: 6 of 6 behaviour mutants killed (a style-only variant change survives by design).
- 2026-11-11: Not checked: a browser, a real BE, screenshots, mutation tool (#67). The component is not mounted on any route.

## Lessons

<fill when done>
