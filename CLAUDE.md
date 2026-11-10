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

BE (run in `BE/`, Node 22 (22.22.3+), 24 (24.15+) or 26+ — not 23 or 25; the range is `BE/package.json` `engines`; pnpm as for FE). Settings come from `BE/.env` (copy `BE/.env.example`); a bad value stops the server at boot:

| Task | Command |
| --- | --- |
| Install (CI-exact) | `pnpm install --frozen-lockfile` |
| Dev server (watch, port 3000, routes under `/api`) | `pnpm dev` |
| Lint ([ESLint](https://eslint.org) — type-aware) | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Test ([Vitest](https://vitest.dev) — unit `src/**/*.spec.ts` and e2e `test/*.e2e.spec.ts`) | `pnpm test` |
| Build / run the build | `pnpm build` / `pnpm start` |
| Verify (lint → test → build, stops at the first failure; `build` runs `tsc --noEmit` over the tests too, so typecheck is included; run before every commit) | `pnpm verify` |
| Container image (run from the repo root; local dev only, production is EC2) | `docker build -t be BE` |

AI and the mutation-test command: TBD — added with each stack.

## Pitfalls

- **When the user asks to log out, call `useAuth().signOut()`, not `supabase.auth.signOut()`.** The provider's manual-logout flag is what keeps the next protected page from showing the "session expired" screen (`apiFetch` calls the Supabase one on purpose after a 401, because there the expired screen is wanted).
- **Supabase's built-in mail server is tiny.** It sends only to team members, 2 mails per hour. Test signup and password reset with faked responses, and create demo or judge accounts in the dashboard (Add user + Auto Confirm User) instead of signing them up ([auth.md](docs/design/auth.md#가입과-비밀번호-재설정)).

Add more lessons everyone should know as they come up ([CONTRIBUTING.md §1 step 8](CONTRIBUTING.md#1-how-we-work-sdd--task-workflow)).
