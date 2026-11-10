# FE signup and password reset — lessons

## Log

- 2026-11-10: #69 merged. Started `feat/fe-signup-reset` from `upstream/main`. The deploy-spec screen (#71) is on hold until BE #76 (save API, field validation); signup and reset are the FE work in between.
- 2026-11-10: #52 done. The password field with its show/hide button moved out of `LoginPage` into `components/PasswordField.tsx` because signup and reset need four more of them.

- 2026-11-10: #55 done. The reset page decides what it is showing from the address it was opened with (see Lessons), not from the `PASSWORD_RECOVERY` event.

- 2026-11-10: Rebased onto `upstream/main` after BE #70 merged; the only conflict was the adjacent rows in `docs/ai-scope.md` (kept our signup/reset text on the Supabase rows and #70's commit text on the GitHub API row).
- 2026-11-10: `/code-review` (10 findings) and `/simplify` (4 angles). Fixed: the login screen's resend now also returns to `/profile`; the recovery link needs `type=recovery` **and** a token in the address on arrival; unknown mail errors no longer say "cannot connect"; the cooldown compares a deadline instead of counting ticks; the "check your mail" resend block is one component (`auth/ResendControls.tsx`); shared redirect URLs, password/email error copy and the call wrapper (`callMail`/`mailResult`).
  Skipped on purpose: `signUp` returning a session (the project requires email confirmation, #49), a lock after a rate-limited first submit, focus management on screen swaps (the whole app lacks it), the "differs from email" rule showing met while the email is empty, `signOut` failure after a saved password (rare; the password is already changed), splitting the reset page into two components, reading the recovery state from `useAuth()` or `PASSWORD_RECOVERY` (see the lesson below: that event can be missed), and a shared `EmailField`.
- 2026-11-10: Browser check done in Chromium with faked Supabase responses (not a real mail round trip).

## Lessons

- **`<input type="email">` already trims.** Both browsers and jsdom strip leading and trailing spaces from the value, so a `.trim()` on the email is unreachable for a test (a mutation that removes it survives). Keep the trim, it costs nothing, but do not write a test for it.
- **Do not tell the user whether an address is registered.** Supabase answers a sign-up for a known address with success and no new mail, and a password reset for an unknown address with success. The screens show the same "check your mail" text in both cases and only add "it may not come if you already have an account".
- **A hidden tab throttles timers, so count to a deadline.** `useCooldown` stores the end time and compares it with `Date.now()` on each tick; a tick counter stays locked for as long as the tab slept.
- **How the reset page knows it was opened from a recovery link.** supabase-js emits `PASSWORD_RECOVERY` from a `setTimeout` right after it has read the address, so a React effect can subscribe too late to see it. The page reads the address instead: an error in the query or hash means an unusable link, `type=recovery` plus an `access_token` in the hash means a link to check (`type=recovery` alone is not a mail link). Then it waits for `getSession()`, which resolves after supabase-js has used the token. A token that worked is removed from the address (`window.location.hash = ''`) and saved as a session; a token that failed stays in the address. So "session exists and no `access_token` left in `window.location.hash`" is a good link, anything else is the expired screen. The second half matters: a user who was already signed in has a session even when the link was dead.
- **End the recovery session after the password is saved.** Otherwise the "log in with your new password" screen is a lie, because the user is already in. Use `useAuth().signOut()` and not `supabase.auth.signOut()` directly: the provider's manual-logout flag is what keeps the next protected page from showing the "session expired" screen (X1).
