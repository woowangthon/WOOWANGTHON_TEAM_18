# CONTRIBUTING.md

> How we work: the SDD + task workflow, git and PR rules. Read it before starting a task or opening a PR.
> Always-on rules (hard constraints, coding principles, commands, pitfalls) live in [`CLAUDE.md`](CLAUDE.md).
> **Language**: agent-facing file, written in English. PR descriptions are written in Korean.

## 1. How we work (SDD + Task Workflow)

We adopt [Spec-Driven Development](https://github.com/github/spec-kit) **as a methodology only** — no slash commands, no extra tooling. Skip a step only when it truly does not apply; keep the order. A one-commit fix needs no task pair.

0. **Principles** — before starting, read [CLAUDE.md §2 Coding principles](CLAUDE.md#2-coding-principles) and [`docs/conventions.md`](docs/conventions.md).
1. **Spec** — find the `UC-xx` and `FR-NNN` this work serves in [`docs/SRS.md`](docs/SRS.md) (§3 use cases, §4 functional requirements, §5 non-functional). No FR → ask before building.
2. **Plan** — write down the approach and trade-offs before touching code (no over-engineering). A decision that is expensive to reverse (stack, data store, AI model, API shape) gets an [ADR](docs/adr/README.md): decide in a meeting, then write it down — it is final once merged. To change one, write a new ADR and mark the old one `대체됨` — or, when only one item of a bundled ADR changes, `유효 (일부 대체: <항목> → NNN)` ([ADR rules](docs/adr/README.md)). One decision per new ADR. A module's internal design goes in [`docs/design/`](docs/design/README.md) right before you implement it. Before changing an API between FE/BE/AI, update [`docs/design/api.md`](docs/design/api.md) first.
3. **Task** — work spanning more than one commit or session gets a [task pair](tasks/README.md) in `tasks/active/`: `YYYYMMDD-<slug>-todo.md` (what to do: **Plan**, **Todo**, **Done when**) and `YYYYMMDD-<slug>-lessons.md` (what happened along the way: **Log**, **Lessons**), copied from `tasks/templates/`. Update the Log as you go.
4. **Branch + build** — branch from `upstream/main`. **Code and tests are a pair**: a behavior change lands with its tests in the same commit, never "tests later". Define the success criteria first, write tests that fail without the change, implement, and iterate until green. Before opening the PR, run **mutation testing** on the code you changed; every surviving mutant gets either a new test or a one-line reason in the PR body. Every commit passes lint and tests. The test and mutation tools are chosen with the stack ([ADR](docs/adr/README.md)) and their commands go in [Commands](CLAUDE.md#commands). Commit format: [§2](#2-git).
5. **Self review (recommended)** — before opening the PR, run `/code-review` and `/simplify` once on the branch (the review level is your call), fix what is real, and re-run the tests. Skip on trivial changes; a teammate's review is the gate. Whether an agent can launch them depends on its harness (`/code-review ultra` is always user-triggered); when it cannot, say so and ask — never let a skipped review read as a clean one. Non-blocking findings you leave become known limitations in the PR body.
6. **Sync + open PR** — `git fetch upstream && git rebase upstream/main` to surface conflicts before pushing. Title ≤70 chars; body = the [PR template](.github/pull_request_template.md). CodeRabbit reviews a PR once, when it is opened.
7. **Address review** — evaluate each finding technically; push back with reasoning when wrong. Reply in the comment thread, not top-level (`gh api repos/woowangthon/WOOWANGTHON_TEAM_18/pulls/{pr}/comments/{id}/replies -f body='...'`). If `main` moved during review, rebase again. CodeRabbit does not re-run on push; comment `@coderabbitai review` when you want another round.
8. **Before merge / done** — confirm CI green and one teammate's approval. If the UI or a flow changed, walk the demo path yourself. Fill the lessons file's **Lessons** in the PR; leave the files in `tasks/active/` — the maintainer (TaeTaeJin) sweeps merged tasks into `tasks/archive/` weekly. A lesson worth keeping for everyone goes into [Pitfalls](CLAUDE.md#pitfalls) or [`docs/conventions.md`](docs/conventions.md) in the same PR. Squash merge, then start a new session for the next task. At the end of the day, run `devlog` to post to Notion ([`.claude/skills/`](.claude/skills/README.md)).

**`gh` and remotes**: pass `--repo` explicitly to any `gh` command run outside this directory or when switching between `upstream` and `origin`, so it never targets the fork by accident.

**Delegating work**: hand repo-wide fact-finding (where is X defined, which files reference Y) to a search/explore-style sub-agent when your tool has one (Claude Code's `Explore`). Small, localized edits are done directly. **Judgement calls are never delegated** — what a feature should do and which trade-off wins stay with whoever is accountable, so ask the human. When another project's solution is the reference, take what it defends against, not how it calls the API.

## 2. Git

- **Commit prefixes**: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`.
- **Commit messages**: subject ≤70 chars says *what* changed; the body says *why*; blank line 2. In shell, use multiple `-m` flags or `$'...'` for real newlines — not `\n` inside `"..."`.
- **Remotes**: `upstream` = the team repo ([`CLAUDE.md`](CLAUDE.md) §0), `origin` = your personal fork. Branch from `upstream/main`, push the branch to `origin`, open the PR into `upstream/main`. Fork PRs get no repository secrets in CI.
- **Branches**: `<type>/<slug>` (e.g. `feat/upload-form`). Never commit to `main` directly.
- **PRs**: fill [`.github/pull_request_template.md`](.github/pull_request_template.md); one teammate approves; squash merge. CodeRabbit's comments are advice ([`.coderabbit.yaml`](.coderabbit.yaml)); a teammate's approval is the gate.
- **`main` is protected** by a ruleset (PR + 1 approval, no force push, no deletion, squash only, no bypass). Every teammate is a repo admin, so the ruleset guards against accidents, not people. Emergency near the deadline with no reviewer: an admin sets the ruleset to *Disabled*, merges, and sets it back to *Active* immediately — then says so in the team chat.
- A change and the doc it affects go in the same PR.

## 3. Where things are recorded

| Place | Holds | Why there |
| --- | --- | --- |
| This repo | Spec, decisions, code, task notes | Agents read it; it is what gets judged |
| Notion team page | SRS draft, meetings, kanban, devlog, retro | Required submission; judged for the Notion prize |
| Discord | Organizer notices and questions (`#질문-문의`) | The official channel |

Decisions made in Notion or chat land here as an ADR or an SRS edit. Sync runs one way, into the repo.

The SRS is written in Notion by the whole team. `docs/SRS.md` follows it through a `docs:` PR that syncs the changes; do not edit `docs/SRS.md` without the matching Notion change.
