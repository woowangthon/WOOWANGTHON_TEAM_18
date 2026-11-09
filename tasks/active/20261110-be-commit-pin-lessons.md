# BE commit pin — lessons

## Log

- 2026-11-10: PR #48 was squash-merged, so this branch starts from `upstream/main` instead of merging into the old branch (a merge would carry the same change twice). Two local changes in the work folder that were not made in this session (root `.env.example` deleted, a BE-style untracked `FE/.env.example`) were put in `git stash` untouched; #59 adds `FE/.env.example` and would have blocked the switch.
- 2026-11-10: Owner's decisions: the commit comes from `repos/check`; the confirmed spec is stored in Supabase (as a later task); this task stops at "commit pinned and used by deploy-spec".
- 2026-11-10: Real GitHub answers probed unauthenticated (api quota 60 → 46 for the whole probe). `GET /repos/TaeTaeJin/NoTI/commits/HEAD` answers `200` JSON of 4.7 KB with `sha` (40 hex) plus the commit's file list and stats, so it grows with the commit; with `Accept: application/vnd.github.sha` it answers `200` with only the 40-character SHA as `application/vnd.github.sha` text (40 bytes). `git/trees/<commit sha>?recursive=1` works. A real **tree** SHA also works there (`200`, same 335 entries) but `raw.githubusercontent.com/<o>/<r>/<tree sha>/<path>` is `404`, while the commit SHA is `200` — so a tree SHA would silently make every `package.json` "unreadable". `commits/<tree sha>` is `422 No commit found for SHA`, a missing 40-hex SHA is `422 Invalid object requested` on trees, a SHA of an unrelated repo is `422`, a short SHA is accepted by GitHub (we do not accept it), raw with a missing SHA is `404`. Not verified: `commits/HEAD` on an empty repo (the owner's public empty repos could not be found; `sanp` / `sanp2` answered 404 as private) and a commit that only exists in another fork of the same network. Consequence: with a `commit`, deploy-spec asks `commits/<sha>` first (3 calls instead of 2) and maps `404` / `409` / `422` to `404 COMMIT_NOT_FOUND`. One submission now costs 2 + 2 + 3 = 7 unauthenticated calls (about 8 per hour per server IP).
- 2026-11-10: The probe changed the design twice: the cheap `sha` media type instead of the JSON commit, and an explicit commit check instead of trusting `git/trees`. Reading the real answers before writing code is what found the tree-SHA trap.

## Lessons

<filled when done>
