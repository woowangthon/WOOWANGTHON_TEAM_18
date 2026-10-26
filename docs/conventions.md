# Code Conventions

The checkable form of [`AGENTS.md`](../AGENTS.md) §1 and §3. Language-specific style (naming, formatting, imports)
is whatever the stack's formatter and linter enforce — chosen in [`adr/001-stack.md`](adr/001-stack.md), not restated here.

## 1. Markers: `MOCK(<id>)` and `SAMPLE(<id>)`

The rules forbid presenting a fixed result as live behavior, and require marking mocks, samples and test
accounts ([`hackathon.md`](hackathon.md) §구현 및 공개 범위). Markers make that list greppable.

| Marker | Use for | Example |
| --- | --- | --- |
| `MOCK(<id>):` | Code that returns a canned result instead of doing the real work | stub AI response, fake payment, hardcoded API reply |
| `SAMPLE(<id>):` | Real code running on prepared or synthetic data | seed users, demo dataset, test account |

```ts
// MOCK(ai-summary-stub): returns a fixed summary until the LLM call lands (FR-03)
```

```python
# SAMPLE(demo-students): 20 synthetic transcripts, no real student data
```

Rules:

- `<id>` is kebab-case and unique. **Every id has exactly one row in [`ai-scope.md`](ai-scope.md) §3**, added in the same commit.
- The comment says what is fake and, for a MOCK, what replaces it.
- Removing the mock removes the marker and the row.
- A mock still in the demo path at submission is disclosed in the video (`모킹` caption) and the deck appendix.
- CI will check markers against `ai-scope.md` once it exists ([`adr/001-stack.md`](adr/001-stack.md) §결과). Until then: `grep -rnE "(MOCK|SAMPLE)\(" apps/`.

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

**Instead**: edit [`design.md`](design.md) §3 in the same PR, and tell the other side.

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
- Branch `<type>/<slug>`; PR into `main`; squash merge. See [`AGENTS.md`](../AGENTS.md) §5.
