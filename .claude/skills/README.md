# Skills

What this repository ships for agents, and which external plugins are worth installing.

**None of these fire automatically, and none are required.** Suggest one where it fits; the person decides.

## Repository skills

| Skill | What it does | When |
| --- | --- | --- |
| [`devlog`](devlog/SKILL.md) | Collects today's commits, PRs and task-file updates, writes a Korean devlog entry to the team's Notion devlog database | End of each working day, by each member. Feeds the Notion special prize ([`docs/hackathon.md`](../../docs/hackathon.md) §시상) |

### Deliberately not skills

Task files and ADRs are "copy a template, follow one rule" — [`tasks/README.md`](../../tasks/README.md) and
[`docs/adr/000-template.md`](../../docs/adr/000-template.md) plus the rules in [`CONTRIBUTING.md`](../../CONTRIBUTING.md) §1 are enough.
Promote either to a skill only if the same mistake keeps recurring.

Submission checks are not a skill either: they become CI once the stack is decided (checklist in [`docs/adr/README.md`](../../docs/adr/README.md)).
Until then, the manual checklist is [`docs/hackathon.md`](../../docs/hackathon.md) §마감 직전 체크리스트.

## Optional external plugins

Pointers, not vendored copies — install the current version from the source.

| Plugin | Why | When |
| --- | --- | --- |
| `andrej-karpathy-skills` ([source](https://github.com/multica-ai/andrej-karpathy-skills)) | The four principles in [`CLAUDE.md`](../../CLAUDE.md) §2, as a skill | While writing code |
| `code-review` (`/plugin install code-review@claude-plugins-official`) | Catches bugs before the PR. You choose the review level (`low` gives few, high-confidence findings; higher levels cost more) | Before opening a PR on a non-trivial change |
| `/simplify` (built in) | Finds over-built code that still works — the shape [`docs/conventions.md`](../../docs/conventions.md) F-2 forbids | Before opening a PR |
| `taste-skill` ([source](https://github.com/Leonxlnx/taste-skill)) | Frontend art direction that steers screens away from templated, generic looks. Where it disagrees with the tokens in [`docs/design/design-system.md`](../../docs/design/design-system.md), the tokens win | While building or restyling FE screens |
| `refactoring-ui-skill` ([source](https://github.com/s0xDk/refactoring-ui-skill)) | The mechanical rules of the book *Refactoring UI*: hierarchy through weight and color, fixed spacing and type scales, depth. Its own color, shadow and radius scales do not apply here — the tokens in [`docs/design/design-system.md`](../../docs/design/design-system.md) and `components/ui` come first | While building or restyling FE screens |

Running `/code-review` and `/simplify` from a Sonnet session is recommended to save cost, not required. In a 3-week
hackathon, skip them on small PRs — a teammate's review is the gate.
