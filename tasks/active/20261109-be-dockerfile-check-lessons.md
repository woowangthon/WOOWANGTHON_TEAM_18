# BE Dockerfile check API — lessons

## Log

- 2026-11-09: Chose a separate endpoint over a new field on `/repos/check` (TaeTaeJin: step 1 is "is this my repo", step 2 only runs if it passes). The cost is one more GitHub call per use, noted in `auth.md`'s known limits (unauthenticated 60/h per IP).
- 2026-11-09: The new endpoint repeats the ownership check on the server instead of trusting the FE order. A direct call from a non-owner must stop before the file list; a test asserts no `git/trees` call happens for each ownership error.
- 2026-11-09: `default_branch` is validated only in the new endpoint. Making the shared repo-answer check require it would have made `/repos/check` fail on an answer it never needed (a test keeps that behavior).
- 2026-11-09: `truncated` is passed through. GitHub cuts the recursive list of very large repos, and an empty list there must not be read as "no Dockerfile".
- 2026-11-09: Hand-made mutants, all killed: counting folders named `Dockerfile` (no `blob` check), matching `MyDockerfile` (`endsWith('Dockerfile')`), branch name not URL-encoded, ignoring the HTTP status when the body looks fine, always `truncated: false`.
- 2026-11-09: The real `git/trees` response was checked with an unauthenticated call (fields as the code assumes, missing branch `404`). The full path with a real Supabase token was not run here.

## Lessons

- An endpoint that "only runs after step 1 passed" in the UI flow still has to enforce step 1 itself; the order in the FE is not a guard.
- Known gap: an empty repo (no commits) probably makes the trees call fail and shows as `503`. Not verified against GitHub, so no special case was added; handle it if a student hits it.
