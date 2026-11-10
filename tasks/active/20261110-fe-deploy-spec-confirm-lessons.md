# FE deploy settings edit and confirm screen (#71) — lessons

## Log

- 2026-11-10: Started from `upstream/main` ccfc4f4 (BE #79 merged, #80 not). New worktree `WOOWANGTHON_TEAM_18_fe71`.
- 2026-11-10: Built against the #80 values (slug 40, name 30, timeout 5..300, one service per role, no shared `ingressPath`, `mail` reserved). They sit in `deploy/limits.ts`; the server's `fields` stay the authority.
- 2026-11-10: `DockerfileCheck` now reports the found paths through `onDone`; the draft form needs them to pick `build.dockerfile`, and the draft is requested only after that, once per repo + commit.
- 2026-11-10: Decisions made without a ruling in the issue: `build.context` is the folder of the lock file (root `.` when it sits there), else `dir`; `nodeVersion` takes the first numeric version of `engines.node` and shows the raw range; the role is guessed only for `vite-react` (→ `fe`); more than 3 folders start with the first 3 and the rest are added from a select; server errors are cleared on any edit.
- 2026-11-10: `pnpm verify` passed (lint, 16 test files / 284 tests, build). Not run: mutation testing, a real BE round trip, a browser check.

## Lessons

<fill when done>
