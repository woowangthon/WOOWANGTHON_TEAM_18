# FE secret value input screen (#83) — lessons

## Log

- 2026-11-11: Started from `upstream/main` 41a72aa (#96 merged). New worktree `WOOWANGTHON_TEAM_18_fe83`. The #43 / #82 contract is not in `api.md`, so only the contract-free form is built.
- 2026-11-11: `pnpm verify` passed (lint, tests, build). Hand mutants on the form: 503 status check, blank check, clear-on-success, done filter, blank predicate and "failure reset on resend" were killed; the `autoComplete` mutant survived until a test asserted the attribute.
- 2026-11-11: `/code-review low` (second run; the first returned "(none)" after 4 seconds without reading the diff, so it was not trusted). Real: a blocked blank submit left the old 503 notice up — fixed with a test. Not real: a `service/key` id collision (names cannot contain `/`; comment added). Left: no focus move to the first invalid field (matches the other forms; `Field` errors are `role="alert"`); stale `missing` text after a clear is intended.
- 2026-11-11: `/simplify` (4 angles). Applied: failure classification through `failureOf` (a network error now also reads as "not your fault"), per-key `state` instead of two id Sets, `empty` as an array, error text computed before the JSX, test constants. Skipped: reusing `RepoFailureAlert` (the copy needs the extra "values are kept" sentence), merging the two failure Alerts, folding the leak test into the 503 test.
- 2026-11-11: Not checked: a browser, a real BE, the real submit and readiness responses (no contract), mutation tool (#67).
- 2026-11-11: The #83 contract arrived (2cd9432 on `feat/be-secrets`). Rewrote the form per service and added the load/PUT screen, route and link. Decisions: state per service (server reports per service); "값 바꾸기" re-sends every key of that service; whitespace-only values are blocked on the client but sent untouched otherwise; no link to the progress screen yet (#104 may not be merged). Paths in `INVALID_SECRETS` use root `secrets` (same as `NOT_READY`).
- 2026-11-11: Known limitation: `<input type=password>` strips newlines, so a multi-line value (PEM) cannot be typed or pasted as is.
- 2026-11-11: Hand mutants (PUT method, re-read after failure, 404 branch, ready notice, empty-services branch, path root, done mapping, per-service grouping) were all killed.
- 2026-11-11: Not checked: a browser, a real BE round trip (the contract is on an unmerged BE branch), mutation tool (#67).

## Lessons

<fill when done>
- 2026-11-11: #104 merged (main 053528c). Merged `upstream/main` into this branch (conflict only in `App.tsx`; kept both routes). Added the link from the progress screen to `/deploys/:id/secrets` on every `not_started` deploy, which also covers the state after `409 NOT_READY`, because the progress response does not say whether secrets are needed and a new request was not worth it. Hand mutants (link removed, link always shown, wrong href) were all killed. `/code-review low` raised one point on the existing `DeploySecrets.save` (setState after unmount); not changed, React ignores it and no second read can run while the form is open. `/simplify` (4 angles) found nothing to change except inlining one test constant; the repeated link text in `DeploySaved` and `DeployProgress` is left as two copies.
- 2026-11-11: Not checked: a browser, a real BE round trip, mutation tool (#67).
- 2026-11-11: Added `배포 시작하러 가기` (to `/deploys/:id`, where the start button is) inside the "빌드 준비됨" notice, so save → secrets → start has no dead end. Test: shown when ready, hidden when not, href. Hand mutants (always shown, wrong href, removed) were all killed. `/code-review low` asked whether the route exists; checked by hand: `/deploys/:id` is in `App.tsx` and its `not_started` view has the start button. Not checked: a browser, a real BE round trip.
