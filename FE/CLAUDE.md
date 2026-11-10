# FE/CLAUDE.md

The root [`CLAUDE.md`](../CLAUDE.md) rules apply; this file adds the commands and pitfalls of `FE/`.

## Commands

FE (run in `FE/`, Node 22 (22.22+) or 24, [pnpm](https://pnpm.io) — the version is pinned in `FE/package.json` `packageManager`; `corepack enable` picks it up, but Node 25+ no longer bundles corepack, so run `npm i -g corepack` first there):

| Task | Command |
| --- | --- |
| Install (CI-exact) | `pnpm install --frozen-lockfile` |
| Dev server | `pnpm dev` |
| Lint ([ESLint](https://eslint.org) — type-aware and a11y rules) | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Test ([Vitest](https://vitest.dev)) | `pnpm test` |
| Build | `pnpm build` |
| Verify (lint → test → build, stops at the first failure; `build` runs `tsc -b`, so typecheck is included; run before every commit) | `pnpm verify` |
| Container image (run from the repo root; local dev only, production is S3 + CloudFront) | `docker build -t fe FE` |

## Pitfalls

- **When the user asks to log out, call `useAuth().signOut()`, not `supabase.auth.signOut()`.** The provider's manual-logout flag is what keeps the next protected page from showing the "session expired" screen (`apiFetch` calls the Supabase one on purpose after a 401, because there the expired screen is wanted).
- **Supabase's built-in mail server is tiny.** It sends only to team members, 2 mails per hour. Test signup and password reset with faked responses, and create demo or judge accounts in the dashboard (Add user + Auto Confirm User) instead of signing them up ([auth.md](../docs/design/auth.md#가입과-비밀번호-재설정)).
- **Vite dev on a WSL `/mnt/c` checkout can serve stale code.** File-change events do not arrive, so edits do not show up until the dev server is restarted. Restart it, or set `server.watch.usePolling`, before judging a change.
- **Read refs and other mutable values when the event arrives, not inside a `setState` updater.** React runs the updater at render time, after the code that set the ref may have cleared it (the manual-logout flag in `AuthProvider` made every logout show the session-expired screen). In tests, emit the auth event after an `await`; an event emitted synchronously inside `act` passed on the buggy code.
- **`test.env` in `vite.config.ts` beats the local `FE/.env`.** That keeps tests independent of CI (no `.env`) and of a developer's real values.
- **A hidden tab throttles timers, so count to a deadline.** Store the end time and compare it with `Date.now()` on each tick (`useCooldown`); a tick counter stays locked for as long as the tab slept.
- **`pnpm verify` can fail with timeouts on a slow machine, even on untouched `upstream/main`.** Check that the same tests fail there, then run `pnpm exec vitest run --testTimeout=60000 --hookTimeout=60000` and say so in the PR. Run FE and BE one after the other; parallel runs time out vitest workers.
