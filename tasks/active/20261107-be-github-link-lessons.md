# BE GitHub link + repo-ownership check — lessons

## Log

- 2026-11-07: Before building, called `GET /auth/v1/user` with the test account's token: `identities` is in the response (an `email` entry; `provider: github` appears after linking), `identities[].id` is the provider user id as a string, no `apikey` header → `401 No API key found`, forged token → `403 bad_jwt`. That removed the service role key from the plan (ADR-007 had assumed it) and decided the 401 mapping: Supabase `401`/`403` → `INVALID_TOKEN`, anything else not OK → `503`.
- 2026-11-07: Dropped the "service role key" sentence in ADR-007's consequences rather than superseding the ADR: the decision (link GitHub, compare numeric IDs) is unchanged; only a prediction about the mechanism was wrong. Called out in the PR body.
- 2026-11-07: GitHub's public API: owner has `id` and `type` (`User` / `Organization`), a missing or private repo is `404` (indistinguishable), unauthenticated limit is 60 req/h per IP. The limit is noted in `auth.md`; a bot token (ADR-002) would raise it, not added now.
- 2026-11-07: The raw token must reach the controller to be forwarded to Supabase, but `GET /api/me` returns `AuthUser` whole. Putting the token on `AuthUser` would have leaked it into that response; it lives in `req.accessToken` instead, and a mutant that moves it into `AuthUser` is killed by the existing strict `/api/me` test.
- 2026-11-07: Hand-made mutants on the URL parser and the service: two survivors on the parser — `.git` stripped anywhere (no test for `my.github.io`) and the `.`/`..` repo-name check, which looked dead because `URL` already resolves dot segments, but `..git` loses `.git` and leaves `.` (test added, check kept). Two survivors on the service — ignoring the HTTP status when the body looks fine — fixed with tests that answer 500 / 403 with a well-formed body.
- 2026-11-07: A shell chain `pnpm verify | grep ...; git commit` committed code that failed lint (the pipe hides the exit code). Amended before pushing; later runs write the log to a file and check `$?`.

## Lessons

- Probe the external API with a real call before designing around what its docs or an earlier plan assumed; it removed a secret from the server.
- Do not put a credential on an object that another route returns as-is.
- A check that looks dead may guard a path that only another transformation opens (`..git` → `.`); try to construct an input before deleting it.
- Never let a pipe stand between a gate (`verify`) and the next step; check the exit code.
