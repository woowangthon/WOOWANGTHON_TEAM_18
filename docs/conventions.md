# Code Conventions

The checkable form of [`CLAUDE.md`](../CLAUDE.md) §1 and §2. Language-specific style (naming, formatting, imports)
is whatever the stack's formatter and linter enforce — chosen with the stack (see [`adr/README.md`](adr/README.md)), not restated here.

## 1. Markers: `MOCK(<id>)` and `SAMPLE(<id>)`

The rules forbid presenting a fixed result as live behavior, and require marking mocks, samples and test
accounts ([`hackathon.md`](hackathon.md) §구현 및 공개 범위). Markers make that list greppable.

| Marker | Use for | Example |
| --- | --- | --- |
| `MOCK(<id>):` | Code that returns a canned result instead of doing the real work | stub AI response, fake payment, hardcoded API reply |
| `SAMPLE(<id>):` | Real code running on prepared or synthetic data | seed users, demo dataset, test account |

```ts
// MOCK(ai-summary-stub): returns a fixed summary until the LLM call lands (FR-002)
```

```python
# SAMPLE(demo-students): 20 synthetic transcripts, no real student data
```

Rules:

- `<id>` is kebab-case and unique. **Every id has exactly one row in [`ai-scope.md`](ai-scope.md) §3**, added in the same commit.
- The comment says what is fake and, for a MOCK, what replaces it.
- Removing the mock removes the marker and the row.
- A mock still in the demo path at submission is disclosed in the video (`모킹` caption) and the deck appendix.
- CI will check markers against `ai-scope.md` once it exists (a CI item of the stack ADR, see [`adr/README.md`](adr/README.md)). Until then: `git grep -nE "(MOCK|SAMPLE)\(" -- FE BE AI Infra`.

## 2. Forbidden shapes

Code that works in the demo and is still wrong.

### F-1 — Silent fallback to a plausible answer

**Forbidden**: catching an AI/API failure and returning a canned or empty result that looks like success.
In a hackathon this is how a "fixed result presented as live" happens by accident.

**Instead**: surface the failure to the user (error state, retry, hand-off to a human). If a fallback is
genuinely wanted, it is a `MOCK(<id>)` and gets declared.

### F-2 — Building past the demo path

**Forbidden**: P1 work, config switches, plugin points or abstractions while a P0 in [`SRS.md`](SRS.md) is unfinished.

**Instead**: the shortest code that makes the next P0 step work end to end. One implementation, no interface for it.

### F-3 — Contract drift

**Forbidden**: changing a request/response shape between FE, BE and AI in code only.

**Instead**: edit [`design/api.md`](design/api.md) in the same PR, and tell the other side.

## 3. Secrets

- Keys live in `.env` (git-ignored) locally and in the deploy platform's env settings.
- Commit a `.env.example` with variable names and empty values.
- A key that reached a commit is leaked even after deletion — rotate it.

## 4. Comments

- Explain *why*, not *what*. No comments narrating history ("changed from X") — that is git's job.
- A deliberate shortcut with a known ceiling says so: `// simple: in-memory store, lost on restart — fine for the demo`.

## 5. Commits and branches

- Prefix: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`. Subject ≤ 70 chars; body says why.
- Message language: Korean or English, whichever the author writes faster.
- Branch `<type>/<slug>`; PR into `main`; squash merge. See [`CONTRIBUTING.md`](../CONTRIBUTING.md) §2.

## 6. Tests and mutation testing

The rule in [`CONTRIBUTING.md`](../CONTRIBUTING.md) §1 step 4 stands — code and tests are a pair, and mutation testing runs on the changed code before the PR.

Decided for FE:

- Test library: Vitest with `@testing-library/react` on jsdom (`pnpm test` in `FE/`).
- Test files sit next to the code they test: `FE/src/**/*.test.ts(x)`, named after the unit or group they cover (`theme.test.ts`, `ui.test.tsx`).

Decided for BE:

- Test library: Vitest (Nest 12's default template, same tool as FE) with `@nestjs/testing` and supertest; `pnpm test` in `BE/` runs unit and e2e tests together.
- Unit tests sit next to the code as `BE/src/**/*.spec.ts` (Nest's naming, what `nest g` generates). Tests that boot the app go in `BE/test/*.e2e.spec.ts` (Vitest's default pattern) and start it with `BE/test/start-app.ts`, which calls `setupApp` the way `main.ts` does, so they run with the real prefix, CORS, error filter and auth guard.
- `BE/vitest.config.ts` only sets the required env (`SUPABASE_URL`, a fake origin) because `ConfigModule` validates env when it is imported. Tests never reach the network: the auth tests stub `fetch` to serve a key set generated in the test.

Decided for AI:

- Test library: pytest with FastAPI's `TestClient` (`uv run pytest` in `AI/`). Lint and format are ruff; types are mypy in strict mode over `ai_server/` and `tests/`.
- Tests sit in `AI/tests/test_*.py`, named after the module or route they cover (`test_config.py`, `test_health.py`). Shared fixtures (settings, app client) are in `AI/tests/conftest.py`.
- Tests never call a real LLM or the real gateway: PydanticAI's `TestModel` · `FunctionModel` stand in for the model, and a fake gateway stands in for the platform server.

Fill in once the mutation tool is decided (for all):

- Mutation tool, and its scope (changed files only, to keep it fast). Until one is chosen, say "mutation testing not run: no tool chosen" in the PR body.
- What counts as an acceptable surviving mutant.

Test hygiene (from the BE tasks):

- A constant imported by the test cannot be tested with itself: `toHaveLength(MAX_ISSUES)` passes when `MAX_ISSUES` becomes 21. Assert the number in the contract (20) as a literal.
- `toEqual` does not prove "returned as is"; use `toBe` when that is the promise.
- Give a fake a fully valid row, so each guard (row shape, row count) is tested by itself; build fixtures in the shape the real service sends (folder entries without a trailing `/`).
- Before deleting a test a reviewer calls redundant, run the mutants: the "duplicate" may be the only thing guarding a check.

Mutants:

- A surviving mutant that behaves the same as the original is dead code: delete the code (or the option) instead of adding a test. Keep the test that proves the attack fails.
- Until a mutation tool is chosen (#67), hand-made mutants are allowed: the runner restores the file in a `finally`, never runs two jobs on the same source file, does not run while the tests are being edited, and says which tests can see each source file (unit and e2e), so a missing command is not read as a test gap.

Test doubles and `MOCK(<id>)` markers (§1): a fake that lives only in test files (a stubbed `fetch`, keys generated in a test) never runs in the app and is not marked. A canned value in `src/` that the running app can return is a mock and needs the marker and an `ai-scope.md` row.
