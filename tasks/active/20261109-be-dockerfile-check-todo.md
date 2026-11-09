# BE Dockerfile check API

- **SRS**: none yet (foundation work for W1; [#25](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/25)). SRS §2.4 has no row for it; adding one needs the matching Notion change first, so it is left for the maintainer.
- **Owner**: TaeTaeJin
- **Branch**: feat/be-dockerfile-check

## Plan

FE flow: ① `POST /api/repos/check` (is this my repo?) → on pass ② `POST /api/repos/dockerfiles`. The second is a separate endpoint so each step has one concern. It still re-runs the ownership check on the server, because the endpoint can be called directly; a non-owner never reaches the file list. One extra GitHub call: `git/trees/<default_branch>?recursive=1` (the branch comes from the repo answer the ownership step already fetched). It lists every path whose file name is exactly `Dockerfile`, sub folders included, so split repos (`FE/`, `BE/`) are not judged "none".

What to do when there is no Dockerfile is **undecided** (#25, #44: main doc sends it back and opens a bot PR; the unmerged PR #32 draft builds from a platform template). So "none" is a `200` with an empty list, not an error. Out of scope: FE wiring, framework detection (#42), pinning to a commit (#41; for now the default branch's latest state).

## Todo

- [x] Docs first: `api.md` contract, `auth.md` step 7 and call count, `ai-scope` — files: `docs/`
- [x] Service: share the ownership check, add the file-list call and the `Dockerfile` filter; controller route — files: `BE/src/repos/`
- [x] e2e tests with hand-made mutants — files: `BE/test/repos.e2e.spec.ts`
- [ ] FE: call `repos/dockerfiles` after `repos/check` passes (separate task)

## Done when

(CI green is left for the PR checks to show.)

- [x] Each commit passes `pnpm verify` (175 tests); docs come before code
- [x] GitHub's real `git/trees` answer has the fields the code reads (`tree[].path` / `type`, `truncated`), checked on `woowangthon/WOOWANGTHON_TEAM_18` (finds `BE/Dockerfile`, `FE/Dockerfile`); a missing branch is `404`
- [ ] Real Supabase + linked test account end to end (not run in this session)
- [x] Tests added; mutation testing not run with a tool (none chosen yet, conventions §6); 5 hand-made mutants killed, see lessons
