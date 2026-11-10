# BE Dockerfile check API — lessons

## Log

- 2026-11-09: Chose a separate endpoint over a new field on `/repos/check` (TaeTaeJin: step 1 is "is this my repo", step 2 only runs if it passes). The cost is one more GitHub call per use, noted in `auth.md`'s known limits (unauthenticated 60/h per IP).
- 2026-11-09: The new endpoint repeats the ownership check on the server instead of trusting the FE order. A direct call from a non-owner must stop before the file list; a test asserts no `git/trees` call happens for each ownership error.
- 2026-11-09: First validated `default_branch` only in the new endpoint, so `/repos/check` would not fail on a field it never needs. Dropped later with its tests: `git/trees/HEAD` resolves to the default branch, so no branch name is needed (see the `/code-review` entry below).
- 2026-11-09: `truncated` is passed through. GitHub cuts the recursive list of very large repos, and an empty list there must not be read as "no Dockerfile".
- 2026-11-09: Hand-made mutants, all 9 killed on the final code: no `blob` check, regex without the `/` boundary, regex without the end anchor, ignoring the HTTP status when the body looks fine, always `truncated: false`, no `409` handling, `409` reported as truncated, a branch name instead of `HEAD`, a tree guard that accepts any entry.
- 2026-11-09: `/code-review medium` found an empty repo (no commits) would be a `503`. Probed GitHub: an empty public repo answers `git/trees/...` with `409 Git Repository is empty.` (so now `200` + `[]`), and `git/trees/HEAD` resolves to the default branch (so the `default_branch` check, URL-encoding and 3 tests were dropped). Skipped as by design: `truncated` passthrough (#46), the 60/h limit (documented), name variants (`Dockerfile.prod`, MVP exclusion).
- 2026-11-09: `/simplify` (4 reviewers) found nothing structural. Applied: a named result type, a regex for the path, a table for the repeated finds tests. One suggestion was wrong: deleting the test "folder named Dockerfile" as a duplicate of the `Dockerfile/` row let the `type === 'blob'` mutant survive, because my helper wrote folders as `Dockerfile/` (a path GitHub never produces) so the regex missed them anyway. The helper now writes folders the way GitHub does (`path` without `/`, `type: tree`) and the mutant dies.
- 2026-11-09: TaeTaeJin also confirmed the other cases (another person's repo, an organization repo, a Dockerfile in a sub folder) against the real Supabase and GitHub.
- 2026-11-09: TaeTaeJin's real run on `TaeTaeJin/NoTI` (a fork) passed the ownership check: the owner is the linked account, so a fork passes by design. Whether to refuse forks is a team decision (not made). The response shape stays `dockerfiles` + `truncated` ([#46](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/46)).
- 2026-11-09: The real `git/trees` response was checked with an unauthenticated call (fields as the code assumes, missing branch `404`). The full path with a real Supabase token was run afterwards by TaeTaeJin (see the `TaeTaeJin/NoTI` entry above).

## Lessons

- An endpoint that "only runs after step 1 passed" in the UI flow still has to enforce step 1 itself; the order in the FE is not a guard.
- A reviewer's "this probably fails" is cheap to settle with one real call; the empty-repo probe turned a guess into a tested behavior.
- When a reviewer calls a test redundant, run the mutants before deleting it; the "duplicate" was the only thing guarding a check, and the fixture was wrong, not the test.
- Build test fixtures in the shape the real service sends (folder entries without a trailing `/`), or a passing test may exercise a different path than production.
