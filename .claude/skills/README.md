# Skills

What this repository ships for agents, and which external plugins are worth installing.

**None of these fire automatically, and none are required.** Suggest one where it fits; the person decides.

## Repository skills

| Skill | What it does | When |
| --- | --- | --- |
| [`devlog`](devlog/SKILL.md) | Collects today's commits, PRs and task-file updates, writes a Korean devlog entry to the team's Notion devlog database | End of each working day, by each member. Feeds the Notion special prize ([`docs/hackathon.md`](../../docs/hackathon.md) §시상) |

### Deliberately not skills

Task files and ADRs are "copy a template, follow one rule" — [`tasks/README.md`](../../tasks/README.md) and
[`docs/adr/000-template.md`](../../docs/adr/000-template.md) plus the rules in [`AGENTS.md`](../../AGENTS.md) §2 are enough.
Promote either to a skill only if the same mistake keeps recurring.

Submission checks are not a skill either: they become CI once the stack is decided ([`docs/adr/001-stack.md`](../../docs/adr/001-stack.md) §결과).
Until then, the manual checklist is [`docs/hackathon.md`](../../docs/hackathon.md) §마감 직전 체크리스트.

## Optional external plugins

Pointers, not vendored copies — install the current version from the source.

| Plugin | Why | When |
| --- | --- | --- |
| `andrej-karpathy-skills` ([source](https://github.com/multica-ai/andrej-karpathy-skills)) | The four principles in [`AGENTS.md`](../../AGENTS.md) §3, as a skill | While writing code |
| `code-review` (`/plugin install code-review@claude-plugins-official`) | Catches bugs before the PR. Run `/code-review low` — few, high-confidence findings | Before opening a PR on a non-trivial change |
| `/simplify` (built in) | Finds over-built code that still works — the shape [`docs/conventions.md`](../../docs/conventions.md) F-2 forbids | Before opening a PR |

Run `/code-review` and `/simplify` from a Sonnet session to save cost. In a 3-week hackathon, skip them on
small PRs — a teammate's review is the gate.
