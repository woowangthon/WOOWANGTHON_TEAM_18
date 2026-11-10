# BE deploy input store — lessons

## Log

- 2026-11-10: Owner asked to build the Supabase save first so the FE can work in parallel. The BE has no database code yet (no client, no migrations, no server key in `BE/.env`), so this is the first database slice. Decisions in the todo (server key, one `deploys` table, SQL migrations, contract + save/read in one PR).
- 2026-11-10: Branch is stacked on `feat/be-commit-pin` (PR #70, not merged): saving must check that the commit belongs to the repo, and `assertCommit` only exists there.

## Lessons

<filled when done>
