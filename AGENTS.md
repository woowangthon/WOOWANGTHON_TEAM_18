# AGENTS.md

> The **single entry point** for this repository. Every AI agent and teammate reads this before starting work.
> Tool-neutral (Claude / Cursor / Copilot alike). `CLAUDE.md` only imports this file — never write project rules into `CLAUDE.md`.
> If personal or global instructions conflict with this repo's rules, the repo rules win.

## 0. Project

- **What**: TBD — one sentence on the product. Full requirements: [`docs/SRS.md`](docs/SRS.md).
- **Who**: Team 18 왕가네식구들 (`@woowangthon/18`), 2026 AI 우왕톤 — theme *"AI는 동료가 될 수 있을까?"*
- **Stack**: TBD — decided in [`docs/adr/001-stack.md`](docs/adr/001-stack.md). Architecture and the FE/BE/AI contract: [`docs/design.md`](docs/design.md).
- **Repo**: [`woowangthon/WOOWANGTHON_TEAM_18`](https://github.com/woowangthon/WOOWANGTHON_TEAM_18) (`upstream`, judged) — one monorepo. Code under `apps/*` (TBD), docs under `docs/`, task notes under `tasks/`.
- **Notion devlog DB**: TBD — the URL the [`devlog`](.claude/skills/devlog/SKILL.md) skill writes to.

---

## 1. Hard constraints (hackathon rules — never trade these for speed)

Source of every fact here: [`docs/hackathon.md`](docs/hackathon.md).

1. **Deadline freeze.** Judging uses the `main` commit hash at **2026-11-15 18:00 KST**. After that, nothing pushed to `main` counts; warn before any push to `main` after the deadline.
2. **No faked results.** Never hardcode an output and present it as live behavior. Mocks, samples and test accounts are allowed **only** when marked in code (`MOCK(<id>):` / `SAMPLE(<id>):`, see [`docs/conventions.md`](docs/conventions.md)) and listed in [`docs/ai-scope.md`](docs/ai-scope.md).
3. **AI scope is declared.** Adding, swapping or removing an AI model, external API, library or dataset updates [`docs/ai-scope.md`](docs/ai-scope.md) in the same commit — including features where AI is *not* applied or *not* verified.
4. **No secrets in git.** API keys go in `.env` (git-ignored) and the deploy platform's env settings. The repo is public.
5. **The demo path works first.** P0 features in `docs/SRS.md` are the demo path. Nothing P1 lands while a P0 is broken.

---

## 2. How we work

Lightweight spec-driven flow. Skip a step only when it truly does not apply.

| Step | Do | Where |
| --- | --- | --- |
| 1. Spec | Find the `FR-xx` this work serves. No FR → ask before building. | [`docs/SRS.md`](docs/SRS.md) |
| 2. Task | Work spanning more than one commit gets a task file. | [`tasks/`](tasks/README.md) |
| 3. Decide | A decision that is expensive to reverse (stack, data store, AI model, API shape) gets an ADR. | [`docs/adr/`](docs/adr/README.md) |
| 4. Build | Small commits; keep `main` deployable. Update the contract in `docs/design.md` before changing an API between FE/BE/AI. | `apps/*` |
| 5. Verify | Run it, walk the demo path, then open the PR. | PR template |
| 6. Log | End of day: run `devlog` to post the day to Notion. | [`.claude/skills/`](.claude/skills/README.md) |

**Judgement calls are not delegated.** Search and fact-finding may go to a sub-agent; what a feature should do, or which trade-off wins, stays with whoever is accountable — ask the human.

---

## 3. Coding principles

The four [Karpathy guidelines](https://github.com/multica-ai/andrej-karpathy-skills):

1. **Think before coding** — don't assume. If ambiguous, surface the trade-off and ask.
2. **Simplicity first** — minimum code that solves the problem. No unrequested features, abstractions or defensive code.
3. **Surgical changes** — touch only what the task needs; follow the existing style.
4. **Goal-driven execution** — define a verifiable success check and iterate until it passes.

Checkable rules: [`docs/conventions.md`](docs/conventions.md).

---

## 4. Doc routing

| When you need | Read | Language |
| --- | --- | --- |
| Hackathon rules, schedule, scoring, submissions | [`docs/hackathon.md`](docs/hackathon.md) | KO |
| What to build, priorities, demo scenario | [`docs/SRS.md`](docs/SRS.md) | KO |
| Architecture, FE/BE/AI API contract | [`docs/design.md`](docs/design.md) | KO |
| Why a technical choice was made | [`docs/adr/`](docs/adr/README.md) | KO |
| Code rules, markers, commits | [`docs/conventions.md`](docs/conventions.md) | EN |
| What is AI / mock / external / unverified | [`docs/ai-scope.md`](docs/ai-scope.md) | KO |
| Presentation and demo video | [`docs/pitch.md`](docs/pitch.md) | KO |
| Task notes | [`tasks/`](tasks/README.md) | EN |
| Skills and plugins | [`.claude/skills/README.md`](.claude/skills/README.md) | EN |

Write each doc in the language listed. Korean docs are the ones judges and teammates read; English ones are for agents.

### Where things are recorded

| Place | Holds | Why there |
| --- | --- | --- |
| This repo | Spec, decisions, code, task notes | Agents read it; it is what gets judged |
| Notion team page | Meetings, kanban, devlog, retro | Required submission; judged for the Notion prize |
| Discord | Organizer notices and questions (`#질문-문의`) | The official channel |

Decisions made in Notion or chat land here as an ADR or an SRS edit. Sync runs one way, into the repo.

---

## 5. Git

- **Commit prefixes**: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`.
- **Remotes**: `upstream` = the team repo above, `origin` = your personal fork. Branch from `upstream/main`, push the branch to `origin`, open the PR into `upstream/main`. Fork PRs get no repository secrets in CI.
- **Branches**: `<type>/<slug>` (e.g. `feat/upload-form`). Never commit to `main` directly.
- **PRs**: fill [`.github/pull_request_template.md`](.github/pull_request_template.md); one teammate approves; squash merge. CodeRabbit reviews every PR ([`.coderabbit.yaml`](.coderabbit.yaml)) — its comments are advice, a teammate's approval is the gate.
- **`main` is protected** by a ruleset (PR + 1 approval, no force push, no deletion, squash only, no bypass). Every teammate is a repo admin, so the ruleset guards against accidents, not people. Emergency near the deadline with no reviewer: an admin sets the ruleset to *Disabled*, merges, and sets it back to *Active* immediately — then says so in the team chat.
- A change and the doc it affects go in the same PR.
