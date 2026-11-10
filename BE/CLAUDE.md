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
- **Do not put a credential on an object that another route returns as it is, and do not reveal whether an address is registered.** Answer the same way for a known and an unknown address.
- **Supabase's built-in mail server is tiny.** See the entry in [FE/CLAUDE.md](../FE/CLAUDE.md#pitfalls).
