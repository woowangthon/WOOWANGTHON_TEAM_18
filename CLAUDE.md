# CLAUDE.md

> The **single entry point** for this repository. Every AI agent and teammate reads this before starting work.
> Always-on rules live in this file; the workflow, git and PR rules live in [`CONTRIBUTING.md`](CONTRIBUTING.md). `AGENTS.md` just tells other tools to read this file.
> **IMPORTANT: read [`CONTRIBUTING.md`](CONTRIBUTING.md) before your first branch, commit or PR in a session.** In Claude Code, [`.claude/hooks/require-contributing.sh`](.claude/hooks/require-contributing.sh) blocks `git commit` / `gh pr create` until it has been read.
> If personal or global instructions conflict with this repo's rules, the repo rules win.
> **Language**: reply to the user in Korean. Agent-facing files (this file, `CONTRIBUTING.md`, skills, `docs/conventions.md`, `tasks/`) are written in English; human-facing docs (`docs/SRS.md`, `docs/system-definition.md`, `hackathon`, `design/`, `adr/`, `ai-scope`, `pitch`) and PR descriptions are written in Korean.

## 0. Project (TBD)

- **What**: TBD — one sentence on the product. Full requirements: [`docs/SRS.md`](docs/SRS.md).
- **Who**: Team 18 왕가네식구들 (`@woowangthon/18`), 2026 AI 우왕톤 — theme *"AI는 동료가 될 수 있을까?"*
- **Stack**: FE React + TypeScript on S3 + CloudFront, BE Nest.js and AI server FastAPI on EC2, Supabase (DB, Auth), AWS CodeBuild for builds, GHCR as the image registry, GoCD deploying to a k3s cluster on school PCs over Tailscale; Kafka is deferred and the external LLM vendor and model are undecided — see [ADR-001](docs/adr/001-stack-and-deployment.md). Architecture: [`docs/system-definition.md`](docs/system-definition.md). Module designs and the FE/BE/AI contract: [`docs/design/`](docs/design/README.md).
- **Repo**: [`woowangthon/WOOWANGTHON_TEAM_18`](https://github.com/woowangthon/WOOWANGTHON_TEAM_18) (`upstream`, judged) — one monorepo. Code under `FE/` (Vite + React), `BE/` (Nest.js), `AI/` (FastAPI), `Infra/` (cluster), docs under `docs/`, task notes under `tasks/`.
- **Notion devlog DB**: TBD — the URL the [`devlog`](.claude/skills/devlog/SKILL.md) skill writes to. The skill is optional; fill this in before running it.

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

## 3. Doc routing

| When you need | Read |
| --- | --- |
| Workflow (SDD + tasks), git, PR, review rules | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Hackathon rules, schedule, scoring, submissions | [`docs/hackathon.md`](docs/hackathon.md) |
| What to build (UC / FR / NFR), demo scenario | [`docs/SRS.md`](docs/SRS.md) |
| How it is structured (users, components, stack, per-user flows, infra, open questions) | [`docs/system-definition.md`](docs/system-definition.md) |
| Module design, FE/BE/AI API contract | [`docs/design/`](docs/design/README.md) |
| Why a technical choice was made | [`docs/adr/`](docs/adr/README.md) |
| Code rules, markers, commits | [`docs/conventions.md`](docs/conventions.md) |
| Commands, versions and pitfalls of `FE/` | [`FE/CLAUDE.md`](FE/CLAUDE.md) |
| Commands, versions and pitfalls of `BE/` | [`BE/CLAUDE.md`](BE/CLAUDE.md) |
| What is AI / mock / external / unverified | [`docs/ai-scope.md`](docs/ai-scope.md) |
| Presentation and demo video | [`docs/pitch.md`](docs/pitch.md) |
| Task notes | [`tasks/`](tasks/README.md) |
| Skills and plugins | [`.claude/skills/README.md`](.claude/skills/README.md) |

Link to docs with plain paths, never `@path` — an `@` import loads the whole file into every session, a plain link is read only when needed. Korean docs are the ones judges and teammates read; English ones are for agents. Code identifiers, commit prefixes and `MOCK(<id>)`/`SAMPLE(<id>)` markers stay in English.

## Commands

Run `pnpm verify` in the folder you changed (`FE/` or `BE/`) before every commit. Commands, versions and stack pitfalls are in [`FE/CLAUDE.md`](FE/CLAUDE.md) and [`BE/CLAUDE.md`](BE/CLAUDE.md).

AI and the mutation-test command: TBD — added with each stack.

## Pitfalls

- **`pkill -f <word>` kills the agent's own shell.** The word is in the shell's own command line, so the shell dies (exit 144). Stop a process by port or pid, or use a `[n]est`-style pattern.
- **Edit draw.io diagrams through the model embedded in the SVG.** Pull the `content` attribute out as a `.drawio`, change cells by id and re-export with `draw.io -x -f svg -e`; the CLI export rewrites the whole file, and a web save renames cell ids and can rename tabs. Scripted edits find cells by their whole text and assert how many matched.

Add more lessons everyone should know as they come up ([CONTRIBUTING.md §1 step 8](CONTRIBUTING.md#1-how-we-work-sdd--task-workflow)); stack-specific ones go to [`FE/CLAUDE.md`](FE/CLAUDE.md) or [`BE/CLAUDE.md`](BE/CLAUDE.md).
