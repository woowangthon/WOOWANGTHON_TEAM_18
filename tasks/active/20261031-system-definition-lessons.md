# System definition — lessons

## Log

- 2026-10-31: Wrote the structure SSOT from the merged diagrams. Decisions made in chat were folded into the document and removed from the open-question table so a decision lives in one place only.
- 2026-10-31: First review round (8 agents + code-review + simplify) found the same facts repeated in 3-6 places (approval model, 80% ceiling, DB backup path, in-app alerts, leader single point of failure). Kept the table that has the reason as the one source and linked from the rest.
- 2026-10-31: The document, not the SRS, is the source of truth for now; the SRS update is a separate PR after the Notion sync. The rule "if they disagree the SRS wins" is switched back once the SRS follows.
- 2026-10-31: Compose was dropped for web+server: the AI writes a small service spec plus one Dockerfile per service and the platform server generates Deployment/Service/Ingress itself. This removed a converter and an open question.
- 2026-10-31: Kafka is used only for the deploy record (`deploy.requested`, `review.completed`, `deploy.approved`). Progress state is a Supabase column; events must be idempotent (keyed by project, round, SHA).
- 2026-10-31: HEAD of the working branch was already the merged #8 commit, so there was nothing to amend; the changes are committed as new commits, one per file, and not pushed.

## Lessons

- **Refer to open questions by title/anchor, never by number.** The table was renumbered three times and every hard-coded "#11" broke. *(Pitfalls candidate)*
- **When the diagram is the source, change the diagram and the text in the same pass.** An embedded diagram that disagrees with the text next to it is the first thing a reviewer notices (`deploy.status`, PostgreSQL choices, "domain: none").
- **Write "who does what on which screen"** in every flow step ("the operator approves in the Admin Page approval queue"); passive sentences ("it goes to the queue") were the main clarity finding.
- **A split PR needs the docs that its rules depend on.** Excluding `ai-scope.md` or the ADRs would have broken the same-PR rule and left dangling links; decide the minimal set before opening the PR.
- **Row-number based scripted edits hit the first match in the whole file.** Replace by section-bounded or unique strings and assert counts; a table row `| 3 |` in one section was overwritten by an edit meant for another.
