# BE/CLAUDE.md

The root [`CLAUDE.md`](../CLAUDE.md) rules apply; this file adds the commands and pitfalls of `BE/`.

## Commands

BE (run in `BE/`, Node 22 (22.22.3+), 24 (24.15+) or 26+ — not 23 or 25; the range is `BE/package.json` `engines`; pnpm as for FE). Settings come from `BE/.env` (copy `BE/.env.example`); a bad value stops the server at boot:

| Task | Command |
| --- | --- |
| Install (CI-exact) | `pnpm install --frozen-lockfile` |
| Dev server (watch, port 3000, routes under `/api`) | `pnpm dev` |
| Lint ([ESLint](https://eslint.org) — type-aware) | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Test ([Vitest](https://vitest.dev) — unit `src/**/*.spec.ts` and e2e `test/*.e2e.spec.ts`) | `pnpm test` |
| Build / run the build | `pnpm build` / `pnpm start` |
| Verify (lint → test → build, stops at the first failure; `build` runs `tsc --noEmit` over the tests too, so typecheck is included; run before every commit) | `pnpm verify` |
| Container image (run from the repo root; local dev only, production is EC2) | `docker build -t be BE` |

## Pitfalls

- **`pnpm verify` can fail on health or hook timeouts, even on untouched `upstream/main`.** Run `pnpm exec vitest run --testTimeout=60000 --hookTimeout=60000` and say so in the PR. Run FE and BE one after the other; parallel runs time out vitest workers.
- **An endpoint enforces its own preconditions.** One that "only runs after step 1 passed" in the UI flow still has to check step 1 itself; the order in the FE is not a guard.
- **Probe the real external API with a call before writing the contract.** Docs and earlier plans were wrong about it: GitHub's `git/trees` accepts a tree SHA but `raw.githubusercontent.com` answers 404 for it, which would have turned every `package.json` into a silent "unreadable", and probing the repo API showed the server needed no secret at all.
- **The top-level `sha` of `git/trees/{rev}` is the `rev` you sent, not the root tree.** Asked with a commit SHA it echoes the commit, so a hash built on it changes on every commit. Read a commit's root tree from `git/commits/{sha}` → `tree.sha`; folder and file SHAs come from the tree entries.
- **Unauthenticated GitHub API calls share 60 per hour per server IP.** Every student deploy on the EC2 used them up on 2026-11-14 and saves failed with 503. Production sets `GITHUB_TOKEN` (5,000 per hour); call `api.github.com` through `githubApiHeaders` and check `rateLimitedUntil` (`BE/src/common/github.ts`) so a limit answers `503 GITHUB_RATE_LIMITED`, not `GITHUB_UNAVAILABLE`. Tests blank `GITHUB_TOKEN` in `vitest.config.ts`, because a shell may already export one.
- **Do not put a credential on an object that another route returns as it is, and do not reveal whether an address is registered.** Answer the same way for a known and an unknown address.
- **Supabase's built-in mail server is tiny.** See the entry in [FE/CLAUDE.md](../FE/CLAUDE.md#pitfalls).
- **Never repeat a request-parse error message in a response or log on an API that takes secrets.** V8's JSON error carries a piece of the body (`Unexpected token 'l', "<start of the body>" is not valid JSON`), and Nest turns it into a plain `BadRequestException(message)`. `ApiExceptionFilter` replaces it with a fixed text; an e2e test sends malformed bodies containing a secret and checks the response and the logs.
