# BE Dockerfile check API

- **SRS**: none yet (foundation work for W1; [#25](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/25)). SRS §2.4 has no row for it; adding one needs the matching Notion change first, so it is left for the maintainer.
- **Owner**: TaeTaeJin
- **Branch**: feat/be-dockerfile-check

## Plan

FE flow: ① `POST /api/repos/check` (is this my repo?) → on pass ② `POST /api/repos/dockerfiles`. The second is a separate endpoint so each step has one concern. It still re-runs the ownership check on the server, because the endpoint can be called directly; a non-owner never reaches the file list. One extra GitHub call: `git/trees/<default_branch>?recursive=1` (`git/trees/HEAD`, so no branch name is needed). It lists every path whose file name is exactly `Dockerfile`, sub folders included, so split repos (`FE/`, `BE/`) are not judged "none". The tree is read at `HEAD` (the default branch); a repo with no commits (GitHub answers `409`) is an empty list, not an outage.

What to do when there is no Dockerfile is **undecided** (#25, #44: main doc sends it back and opens a bot PR; the unmerged PR #32 draft builds from a platform template). So "none" is a `200` with an empty list, not an error. Out of scope: FE wiring, framework detection (#42), pinning to a commit (#41; for now the default branch's latest state).

## Todo

- [x] Docs first: `api.md` contract, `auth.md` step 7 and call count, `ai-scope` — files: `docs/`
- [x] Service: share the ownership check, add the file-list call and the `Dockerfile` filter; controller route — files: `BE/src/repos/`
- [x] e2e tests with hand-made mutants — files: `BE/test/repos.e2e.spec.ts`
- [ ] FE: call `repos/dockerfiles` after `repos/check` passes (separate task)
- [ ] Next PR: draft the deploy spec from `package.json` / the lockfile (framework, language, libraries) as an autocomplete; the student reviews and confirms or edits it (#42). Saving the result in the spec is what #25 still lacks

## Done when

(CI green is left for the PR checks to show.)

- [x] `pnpm verify` passes on the final tree (172 tests); docs come before code. `test/app.e2e.spec.ts` (health, untouched here) timed out at 5 s in 2 of 4 full runs on this WSL machine and passed on rerun and alone: a cold-start flake under load, not looked into further
- [x] GitHub's real `git/trees` answer has the fields the code reads (`tree[].path` / `type`, `truncated`), checked on `woowangthon/WOOWANGTHON_TEAM_18` (finds `BE/Dockerfile`, `FE/Dockerfile`); a missing branch is `404`
- [x] Real Supabase + linked test account, 2026-11-09 (throwaway local page, not committed): `/repos/check` then `/repos/dockerfiles` on `TaeTaeJin/NoTI` (a fork of another person's repo, no Dockerfile) → `200`, `dockerfiles: []`, `truncated: false`. TaeTaeJin then ran the rest against the real Supabase and GitHub (confirmed in the session, results not copied here): another person's repo (403), an organization repo (422) and a Dockerfile in a sub folder
- [x] An empty repo: GitHub's real answer is `409 Git Repository is empty.` (probed on a public empty repo); the file list for it is `200` with `[]`
- [x] Tests added; mutation testing not run with a tool (none chosen yet, conventions §6); 9 hand-made mutants killed, see lessons
