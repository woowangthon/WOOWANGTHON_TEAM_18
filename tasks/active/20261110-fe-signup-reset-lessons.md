# FE signup and password reset — lessons

## Log

- 2026-11-10: #69 merged. Started `feat/fe-signup-reset` from `upstream/main`. The deploy-spec screen (#71) is on hold until BE #76 (save API, field validation); signup and reset are the FE work in between.
- 2026-11-10: #52 done. The password field with its show/hide button moved out of `LoginPage` into `components/PasswordField.tsx` because signup and reset need four more of them.

- 2026-11-10: #55 done. The reset page decides what it is showing from the address it was opened with (see Lessons), not from the `PASSWORD_RECOVERY` event.

## Lessons

- **`<input type="email">` already trims.** Both browsers and jsdom strip leading and trailing spaces from the value, so a `.trim()` on the email is unreachable for a test (a mutation that removes it survives). Keep the trim, it costs nothing, but do not write a test for it.
- **Do not tell the user whether an address is registered.** Supabase answers a sign-up for a known address with success and no new mail, and a password reset for an unknown address with success. The screens show the same "check your mail" text in both cases and only add "it may not come if you already have an account".
- **How the reset page knows it was opened from a recovery link.** supabase-js emits `PASSWORD_RECOVERY` from a `setTimeout` right after it has read the address, so a React effect can subscribe too late to see it. The page reads the address instead: an error in the query or hash means an unusable link, `type=recovery` in the hash means a link to check. Then it waits for `getSession()`, which resolves after supabase-js has used the token. A token that worked is removed from the address (`window.location.hash = ''`) and saved as a session; a token that failed stays in the address. So "session exists and no `access_token` left in `window.location.hash`" is a good link, anything else is the expired screen. The second half matters: a user who was already signed in has a session even when the link was dead.
- **End the recovery session after the password is saved.** Otherwise the "log in with your new password" screen is a lie, because the user is already in. Use `useAuth().signOut()` and not `supabase.auth.signOut()` directly: the provider's manual-logout flag is what keeps the next protected page from showing the "session expired" screen (X1).
