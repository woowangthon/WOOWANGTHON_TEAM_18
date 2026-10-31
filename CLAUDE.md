# CLAUDE.md

> The **single entry point** for this repository. Every AI agent and teammate reads this before starting work.
> Always-on rules live in this file; the workflow, git and PR rules live in [`CONTRIBUTING.md`](CONTRIBUTING.md). `AGENTS.md` just tells other tools to read this file.
> **IMPORTANT: read [`CONTRIBUTING.md`](CONTRIBUTING.md) before your first branch, commit or PR in a session.** In Claude Code, [`.claude/hooks/require-contributing.sh`](.claude/hooks/require-contributing.sh) blocks `git commit` / `gh pr create` until it has been read.
> If personal or global instructions conflict with this repo's rules, the repo rules win.
> **Language**: reply to the user in Korean. Agent-facing files (this file, `CONTRIBUTING.md`, skills, `docs/conventions.md`, `tasks/`) are written in English; human-facing docs (`docs/SRS.md`, `docs/system-definition.md`, `hackathon`, `design/`, `adr/`, `ai-scope`, `pitch`) and PR descriptions are written in Korean.

## 0. Project (TBD)

- **What**: TBD — one sentence on the product. Full requirements: [`docs/SRS.md`](docs/SRS.md).
- **Who**: Team 18 왕가네식구들 (`@woowangthon/18`), 2026 AI 우왕톤 — theme *"AI는 동료가 될 수 있을까?"*
- **Stack**: React + TypeScript (FE), Nest.js (BE), FastAPI (AI server), AWS, Supabase (DB, Auth), Kafka on EC2 — see [ADR-001](docs/adr/001-stack-and-deployment.md). Architecture: [`docs/system-definition.md`](docs/system-definition.md). Module designs and the FE/BE/AI contract: [`docs/design/`](docs/design/README.md).
- **Repo**: [`woowangthon/WOOWANGTHON_TEAM_18`](https://github.com/woowangthon/WOOWANGTHON_TEAM_18) (`upstream`, judged) — one monorepo. Code under `FE/` (Vite + React), `BE/` (Nest.js), `AI/` (FastAPI), `Infra/` (cluster), docs under `docs/`, task notes under `tasks/`.
- **Notion devlog DB**: TBD — the URL the [`devlog`](.claude/skills/devlog/SKILL.md) skill writes to.

## 1. Hard constraints (hackathon rules — never trade these for speed)

Source of every fact here: [`docs/hackathon.md`](docs/hackathon.md).

1. **Deadline freeze.** Judging uses the `main` commit hash at **2026-11-15 18:00 KST**. After that, nothing pushed to `main` counts; warn before any push to `main` after the deadline.
2. **No faked results.** Never hardcode an output and present it as live behavior. Mocks, samples and test accounts are allowed **only** when marked in code (`MOCK(<id>):` / `SAMPLE(<id>):`, see [`docs/conventions.md`](docs/conventions.md)) and listed in [`docs/ai-scope.md`](docs/ai-scope.md).
3. **AI scope is declared.** Adding, swapping or removing an AI model, external API, library or dataset updates [`docs/ai-scope.md`](docs/ai-scope.md) in the same commit — including features where AI is *not* applied or *not* verified.
4. **No secrets in git.** API keys go in `.env` (git-ignored) and the deploy platform's env settings. The repo is public.
5. **The demo path works first.** P0 use cases in `docs/SRS.md` §3.2 are the demo path. No P1 work starts until every P0 works.

## 2. Coding principles

The four [Karpathy guidelines](https://github.com/multica-ai/andrej-karpathy-skills):

1. **Think before coding** — don't assume. If ambiguous, surface the trade-off and ask.
2. **Simplicity first** — minimum code that solves the problem. No unrequested features, abstractions or defensive code.
3. **Surgical changes** — touch only what the task needs; follow the existing style.
4. **Goal-driven execution** — define a verifiable success check and iterate until it passes.

Checkable rules: [`docs/conventions.md`](docs/conventions.md).

## 3. Doc routing (TBD)

| When you need | Read |
| --- | --- |
| Workflow (SDD + tasks), git, PR, review rules | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Hackathon rules, schedule, scoring, submissions | [`docs/hackathon.md`](docs/hackathon.md) |
| What to build (UC / FR / NFR), demo scenario | [`docs/SRS.md`](docs/SRS.md) |
| How it is structured (users, components, stack, per-user flows, infra, open questions) | [`docs/system-definition.md`](docs/system-definition.md) |
| Module design, FE/BE/AI API contract | [`docs/design/`](docs/design/README.md) |
| Why a technical choice was made | [`docs/adr/`](docs/adr/README.md) |
| Code rules, markers, commits | [`docs/conventions.md`](docs/conventions.md) |
| What is AI / mock / external / unverified | [`docs/ai-scope.md`](docs/ai-scope.md) |
| Presentation and demo video | [`docs/pitch.md`](docs/pitch.md) |
| Task notes | [`tasks/`](tasks/README.md) |
| Skills and plugins | [`.claude/skills/README.md`](.claude/skills/README.md) |

Link to docs with plain paths, never `@path` — an `@` import loads the whole file into every session, a plain link is read only when needed. Korean docs are the ones judges and teammates read; English ones are for agents. Code identifiers, commit prefixes and `MOCK(<id>)`/`SAMPLE(<id>)` markers stay in English.

## Commands

TBD — once the stack is decided, list install, dev server, lint, test, mutation-test and build commands here.

## Pitfalls

None yet — add lessons everyone should know as they come up ([CONTRIBUTING.md §1 step 8](CONTRIBUTING.md#1-how-we-work-sdd--task-workflow)).
