# BE deploy spec draft API — lessons

## Log

- 2026-11-09: Started on top of `feat/be-dockerfile-check` because PR #47 (checks green) was still open and this reuses its `verifyOwnership()` and tree call. After #47 is squash-merged: `git rebase --onto upstream/main <last #47 commit>`.
- 2026-11-09: Owner's answers: package.json alone is enough to know the framework and the build (the lockfile only decides the package manager and the install command); lockfile kind only, no content parsing; monorepos answered per folder in one call like `repos/dockerfiles`.
- 2026-11-09: Storage talk (with PR #32 and the dashboard wireframe). In-memory is out: the user may close the page between steps (approval wait, secrets wait), the BE may restart, an AI agent changes the spec and re-runs it, and the dashboard list shows type / db / round / status. The draft itself is recomputed, only the confirmed spec needs storing. Decided: this PR has no DB; the save API waits for a data model.
- 2026-11-09: Real answers probed before design. `raw.githubusercontent.com/<o>/<r>/HEAD/<path>` answers `200` / `404`, has no `X-RateLimit` headers and left the API `core` limit at 60/60; one unauthenticated `git/trees` call cost 1. A real big repo (vitejs/vite) has 317 `package.json`, 22 of them under `node_modules/`, plus lockfiles nested in test fixtures → cap of 10 folders, shallowest first then by name (deterministic), `node_modules/` excluded. The real Vite template's build script is `tsc -b && vite build`, so the draft shows `<pm> run build` and keeps the script text beside it.
- 2026-11-09: Narrowed the issue's "framework default table" to output folder and port only. A default *command* the project does not define (`next build` run through an unknown package manager) would be a guess shown as a fact; a missing script is "needs review" instead.

## Lessons

<filled when done>
