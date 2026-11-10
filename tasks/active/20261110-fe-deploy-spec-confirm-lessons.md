# FE deploy settings edit and confirm screen (#71) — lessons

## Log

- 2026-11-10: Started from `upstream/main` ccfc4f4 (BE #79 merged, #80 not). New worktree `WOOWANGTHON_TEAM_18_fe71`.
- 2026-11-10: Built against the #80 values (slug 40, name 30, timeout 5..300, one service per role, no shared `ingressPath`, `mail` reserved). They sit in `deploy/limits.ts`; the server's `fields` stay the authority.
- 2026-11-10: `DockerfileCheck` now reports the found paths through `onDone`; the draft form needs them to pick `build.dockerfile`, and the draft is requested only after that, once per repo + commit.
- 2026-11-10: Decisions made without a ruling in the issue: `build.context` is the folder of the lock file (root `.` when it sits there), else `dir`; `nodeVersion` takes the first numeric version of `engines.node` and shows the raw range; the role is guessed only for `vite-react` (→ `fe`); more than 3 folders start with the first 3 and the rest are added from a select; server errors are cleared on any edit.
- 2026-11-10: `pnpm verify` passed (lint, 16 test files / 284 tests, build). Not run: mutation testing, a real BE round trip, a browser check.
- 2026-11-11: Rebased onto upstream/main ec0361e (7 commits). One conflict, `docs/ai-scope.md` (the SRS PR rewrote the neighbouring rows): kept upstream's rows and re-applied only my sentence on the draft row.
- 2026-11-11: Re-checked limits against `deploy-handoff.md` and `api.md`: slug 40, name 30, timeout 5..300, one service per role, same `ingressPath` forbidden (prefix overlap allowed), `mail` reserved all match. One value changed: the reserved slug list now follows `cluster.md` §9 (23 names, was 8).
- 2026-11-11: `/code-review low` found two real issues, both fixed: switching 실행 방식 overwrote the typed port with 8080, and `nodeVersionOf` took `23` from `<23`.
- 2026-11-11: `/simplify` (4 angles). Applied: one `FieldIssue` type, `issuesOf`, `dockerfiles` stored on `checked` (no second state), one `isRole`, unused `KINDS` removed, `hint` prop on `Field`/`SelectField` (tied to aria-describedby), `SelectField.onChange` gets the value, one `FailureBlock`. Skipped: running `dockerfiles` and `deploy-spec` in parallel (changes behavior, kept as a known limit), one `appliesTo` rule for form/validator/serializer, a `bind()` helper for the 15 text fields, `AbortSignal` in `apiFetch` (dev StrictMode double request only), `FieldError` extraction for the two row editors.

## Lessons

<fill when done>
