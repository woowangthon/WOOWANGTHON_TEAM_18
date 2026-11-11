# Agent: W6 verify failures — lessons

## Log

- 2026-11-11: First version (9f74719) invented a third raw shape `raw.verify` from the coordinating session's first message, plus a `contains` match test for it. Meanwhile #109 · #107 had been merged with the verify ticket shape already fixed (k8s raw + the failed check in `errorMessage`). The correction came after the push: team `main` was merged in, and the contract files were put back to `main`'s version in a new commit (no force push).
- 2026-11-11: V1 · V2 now match on `errorMessage`. The coordinating session fixed its form with track A (F05): `<service>: GET <path> -> <status>`, `<service>: not ready (<reason>)`, `<service>: no endpoints`; the tests use exactly these.
- 2026-11-11: The session's worker restarted mid-task; the working tree survived and work continued from it.

## Lessons

- Read the merged contract on team `main` before implementing a contract change relayed in a message; a teammate may already have settled it.
