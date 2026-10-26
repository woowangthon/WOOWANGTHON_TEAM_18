---
name: devlog
description: Write today's development log to the team's Notion devlog database, in Korean, from the day's commits, PRs and task-file updates. Use when the user says "devlog", "개발일지", "오늘 한 일 정리", "일지 써줘", or at the end of a working day.
---

# devlog

Turns one member's working day into one Notion devlog entry. The Notion team page is a judged submission
(Notion special prize, [`docs/hackathon.md`](../../../docs/hackathon.md) §시상), so a steady daily record matters
more than a polished one.

Output language: **Korean**. These instructions are English for token efficiency.

## Arguments

Optional, treated as data: a date (`YYYY-MM-DD`, default today) and/or `--team` (all authors instead of
the current git user).

## Steps

### 1. Collect — facts only

Run from the repository root. `<date>` is the target date, `<me>` is `git config user.name`.

```bash
git fetch --quiet
git log --all --since="<date> 00:00" --until="<date> 23:59" --author="<me>" --format='%h %s'
gh pr list --state merged --search "merged:<date> author:@me" --json number,title,url
gh pr list --author @me --json number,title,url,isDraft
git log --all --since="<date> 00:00" --until="<date> 23:59" --name-only --format= -- tasks/ docs/adr/ docs/SRS.md | sort -u
git status --porcelain -- tasks/
```

With `--team`, drop `--author` / `author:@me` / `--author @me`.

Then read the task files and ADRs that appeared: their **Log** lines for the date, and any ADR status change.

### 2. Ask for what git cannot know

Ask the user **once**, in one message: "막힌 것과 내일 할 일이 있나요? (없으면 비워 둘게요)".
Never invent blockers, plans or decisions. If nothing was collected in step 1, say so and ask whether to
write an entry anyway.

### 3. Compose

Title: `YYYY-MM-DD · <이름>` (`· 팀` with `--team`).

```markdown
## 오늘 한 일
- <what changed, in user-facing words> (FR-xx) — PR #n / `abc1234`

## 결정
- <decision> — [ADR-NNN](link) or task file

## 막힌 것
- <from the user, or "없음">

## 내일 할 일
- <from the user>
```

- Group commits by feature, not one line per commit. Use the FR ID from the task file or PR.
- Link PRs and ADRs with full GitHub URLs (`gh repo view --json url -q .url`), so they open from Notion.
- No secrets, tokens, `.env` values or test-account passwords — the page is shared publicly.

### 4. Write to Notion

1. Read the **Notion devlog DB** URL from [`AGENTS.md`](../../../AGENTS.md) §0. If it is `TBD`, stop and ask for it.
2. Fetch the database with the Notion MCP and map to its real properties (title, date, author). Do not assume names.
3. Search the database for an entry with the same title. If one exists, **update it** — never create a duplicate.
4. Otherwise create a page in that database with the composed body.
5. Reply with the page link and a two-line summary.

**No Notion MCP connected?** Print the composed entry as Markdown and tell the user to paste it into the
devlog database. Do not write it to a file in the repo.
