# FE signup and password reset (#52, #55)

- **SRS**: demo path (issues #52, #55; ADR-007: Supabase Auth from the FE, email + password, email verification before sign-up completes)
- **Owner**: TaeTaeJin
- **Branch**: feat/fe-signup-reset

## Plan

Two screens on one branch, one commit per issue. They share the password rules, the password field, the resend cooldown and the mail-error mapping, so those land in the #52 commit and #55 reuses them.

- **#52 Signup** — `supabase.auth.signUp` with `emailRedirectTo = <origin>/profile`, so the verification link comes back signed in and lands on the profile page where the GitHub link guidance already is (#56). After sending: a "check your mail" screen (spam folder hint, resend with a 60 s cooldown, change address). An already registered address gets the same screen: Supabase answers success on purpose (no account enumeration), and the screen says the mail may not come for an existing address. The wireframe S1-S3 still shows the old "signed in right away, no mail" flow, so the mail screen is new.
- **#55 Reset** — one page, `/reset-password`, with states request (R1), sent (R2), new password (R3), link expired (R4), done (R5). A missing address gets the same "sent" screen. See the lessons file for how the page knows it was opened from a recovery link.
- **Not here**: team-outside address and rate-limit behaviour confirmed against the real Supabase (needs a real mail round trip, #49), a signed-in user opening `/signup`, an expired signup link (the user lands on `/login` without an explanation).

## Todo

- [x] Shared pieces: `FE/src/auth/{form-rules,mail-error,useCooldown,PasswordRules,AuthCard}`, `FE/src/components/PasswordField.tsx`; `LoginPage` moved onto them
- [x] #52 signup page + tests, `docs/ai-scope.md` — files: `FE/src/pages/SignupPage.tsx`
- [x] #55 reset page + tests, `docs/ai-scope.md` — files: `FE/src/pages/ResetPasswordPage.tsx`
- [ ] Check both screens in Chromium with faked responses (light/dark, 1440/390), including a recovery link landing
- [ ] `/code-review` and `/simplify` on the range (run with the worktree path), fixes applied
- [ ] Real mail round trip by the user (needs #49): signup mail, verification link back to `/profile`, reset mail, new password

## Done when

- [ ] `cd FE && pnpm verify` passes on every commit
- [ ] Each state is seen in a browser; no console errors, no horizontal scroll
- [ ] Real signup and reset mails are confirmed by the user (needs #49)
- [ ] tests added; mutation testing not run — no mutation tool chosen yet (conventions §6, issue #67), noted in the PR body
