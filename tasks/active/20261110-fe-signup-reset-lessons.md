# FE signup and password reset — lessons

## Log

- 2026-11-10: #69 merged. Started `feat/fe-signup-reset` from `upstream/main`. The deploy-spec screen (#71) is on hold until BE #76 (save API, field validation); signup and reset are the FE work in between.
- 2026-11-10: #52 done. The password field with its show/hide button moved out of `LoginPage` into `components/PasswordField.tsx` because signup and reset need four more of them.

## Lessons

- **`<input type="email">` already trims.** Both browsers and jsdom strip leading and trailing spaces from the value, so a `.trim()` on the email is unreachable for a test (a mutation that removes it survives). Keep the trim, it costs nothing, but do not write a test for it.
- **Do not tell the user whether an address is registered.** Supabase answers a sign-up for a known address with success and no new mail, and a password reset for an unknown address with success. The screens show the same "check your mail" text in both cases and only add "it may not come if you already have an account".
