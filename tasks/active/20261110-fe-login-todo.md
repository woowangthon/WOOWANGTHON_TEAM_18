# FE login screen (#51) and follow-ups from the #59 review

- **SRS**: login and sign-in flow for the demo path (issue #51; ADR-007: email + password through Supabase Auth, directly from the FE)
- **Owner**: TaeTaeJin
- **Branch**: feat/fe-login

## Plan

`/login` is a stub that draws only a heading. This task builds the login screen from the wireframe (boards L1-L4) and, in the same PR, handles the follow-ups seren-wib left on #59 ([review](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/pull/59#pullrequestreview-5826618732)).

- **Screen**: one centered card, no navigation bar. Email and password fields with inline validation, a login failure banner, a rate-limit banner, an unverified-email banner with a resend button, and a submitting state. A successful login goes straight to `/deploy/new` (no success screen). Returning to the page the user came from belongs to #53.
- **Two small UI parts**: `Field` (visible label + error text wired to `Input`) and `Alert` (error / warning / info banner). `Input` keeps its `aria-label`/`aria-labelledby` type; `Field` supplies the label through `aria-labelledby`. `docs/design/design-system.md` is updated in the same PR.
- **Errors are told apart by `error.code` / `status`**, never by message text. No internal terms (Supabase, token, 429) in what the user reads.
- **Tests**: `LoginPage` imports `lib/supabase.ts`, which throws without env, so `vite.config.ts` gets dummy `VITE_*` values for tests. That also keeps the real `FE/.env` out of the tests.
- **Review follow-ups**: (1) `engines` to `^22.22.0` (react-router 8.5.1 needs it) and the matching line in `CLAUDE.md`; (2) CloudFront SPA fallback: no issue, the requirement is written into `docs/system-definition.md` because the CloudFront settings are not in this repo; (4) drop the redundant parts of `vite-env.d.ts`, keep the two `VITE_*` declarations; (3) left as is, the user answers it.
- **Not done here**: session and route guard (#53), API client (#54), signup (#52), reset (#55), GitHub link (#56), mail error code survey.

## Todo

- [x] `engines` to `^22.22.0 || ^24.0.0 || >=26.0.0` and the `CLAUDE.md` Node line — files: `FE/package.json`, `CLAUDE.md`
- [x] Remove the redundant parts of `vite-env.d.ts`, confirm with typecheck, lint, build — files: `FE/src/vite-env.d.ts`
- [x] Record the CloudFront SPA fallback requirement — files: `docs/system-definition.md`
- [x] `Field` and `Alert`, `Input` error border, tests, design-system doc — files: `FE/src/components/ui/*`, `docs/design/design-system.md`
- [x] Test env for `VITE_*` — files: `FE/vite.config.ts`
- [x] Login page with tests for each state — files: `FE/src/pages/LoginPage.tsx`, `FE/src/pages/LoginPage.test.tsx`
- [x] Check in Chromium (light/dark, 1440/390; real Supabase for the invalid-credentials path)
- [x] Independent review with agy, each finding checked before acting

## Done when

- [x] `cd FE && pnpm install --frozen-lockfile && pnpm verify` passes
- [x] Each state of the login screen is seen in a browser; no console errors, no horizontal scroll
- [x] A real login with a test account is confirmed by the user (the password is not pasted anywhere)
- [x] tests added; mutation testing not run — no mutation tool chosen yet (conventions §6), noted in the PR body
