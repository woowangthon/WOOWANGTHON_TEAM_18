# Pipeline glue: fetch-input and notify CLIs — lessons

## Log

- 2026-11-11: started from the coordinating session's request (PR-A of #135). Read api.md and `validateNotice`: BE needs `raw.k8s.status` to be an object on `render` and `null` elsewhere, `raw.codebuild` an object on `build`, and times with a zone in `logs`. `null` in `failure.code` means "student problem, call the AI agent", so the mapper must never turn a bad platform code into `null`.

- 2026-11-11: hand mutants: 56, 3 survived at first (redirect target not checked, 3xx counted as ok, a deploy id of digits only cannot show lowercasing); tests strengthened, all killed. `/code-review low` found one real gap (a report with the wrong shape sent nothing, so the run waited for the timeout): now `STAGE_NO_REPORT`. `/simplify`: one shared `isRecord`, one `Sleep` type, a test that `BE_OWN_CODES` equals BE's `INTERNAL_CODES`; skipped splitting `parseDeployInput`, moving `parseSlot`, a shared URL check.
- 2026-11-11: `pnpm verify` exits 1 in this sandbox only because `kube.spec.ts` "K8S_UNREACHABLE" connects to 127.0.0.1:1, which this sandbox drops instead of refusing (the same test fails on a clean `upstream/main`). Everything else passes; build and lint exit 0.

## Lessons

- A body that BE refuses with 400 is not retried by the CLI, so the run waits for BE's 1-hour sweep. Every way the mapper can produce a body BE refuses (a platform code BE does not accept, a missing `raw.k8s.status` on render, a bad time) is handled in the mapper and covered by a test that feeds the body to BE's own `validateNotice`.
- `null` in `failure.code` means "student problem, call the AI agent". Never fall back to it for a code that cannot be sent.
- Importing BE source into a pipeline spec needs `rootDir` `../..` in the typecheck tsconfig (the build config keeps `./src`).
