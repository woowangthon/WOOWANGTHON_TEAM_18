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
- 2026-11-11: Real BE + Supabase run. The user checked the UI in a browser and saved 2 real deploys. A real saved row showed `kind: static` with port 8080 for a folder whose Dockerfile (nginx) serves on 80, because the draft guessed `static` for every Vite app. Decision #10: a folder with a Dockerfile starts as `server` and the port is typed; choosing `static` with a Dockerfile shows a hint that the container must serve on 8080.
- 2026-11-11: Automated check (headless Chromium, temporary Supabase user, deleted afterwards): the real BE `fields` paths (`runtime.env.<name>`, `build.buildEnv.<name>`, `runtime.links[i].env`) map onto the right rows with the right count; a valid two-service spec passes the shape check and stops at `GITHUB_NOT_LINKED` with the form kept; a network failure and resend reach the same BE answer; `GET /api/deploys/:id` gives 404 `DEPLOY_NOT_FOUND` for unknown and non-UUID ids and 401 without a token. Everything after ownership was only checked with fake responses. The 2 test rows were deleted at the end.

## Lessons

<fill when done>
