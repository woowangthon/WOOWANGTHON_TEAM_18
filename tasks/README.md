# Tasks

Working notes for agents and teammates. The team's kanban lives in Notion; these files hold what an agent
needs to pick the work back up — the plan, the done-check, and what was learned.

## When to create one

Only for work that spans **more than one commit** or more than one session. A one-commit fix needs no file.

## Rules

- One file per task: `tasks/YYYYMMDD-<slug>.md`, English, copied from the template below.
- Link the SRS `FR-xx` it serves. No FR → ask before building ([`AGENTS.md`](../AGENTS.md) §2).
- When done, set `Status: done` and fill **Lessons**. The file stays where it is — no archive step.
- A lesson worth keeping for everyone goes into [`CLAUDE.md`](../CLAUDE.md) Pitfalls or [`docs/conventions.md`](../docs/conventions.md) in the same PR.
- The [`devlog`](../.claude/skills/devlog/SKILL.md) skill reads files touched today, so keep **Log** current.

## Template

```markdown
# <Task title>

- **Status**: active | done
- **SRS**: FR-xx
- **Owner**: <name>
- **Branch**: <type>/<slug>

## Plan

1. <slice> — files: `...`

## Done when

- [ ] <observable check, e.g. "demo step 2 works on the deployed URL">

## Log

- YYYY-MM-DD: <what happened, decisions, blockers>

## Lessons

<filled when done: what surprised us, what to do differently>
```
