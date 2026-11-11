# FE secret value input screen (#83)

- **SRS**: UC-04 follow-up (W3, secret values). No FR number checked in `main` yet.
- **Owner**: TaeTaeJin (FE session)
- **Branch**: feat/fe-secret-inputs

## Plan

Issue #83 starts after the BE contract for #43 (secret values) and #82 (readiness read) is in `docs/design/api.md`. That contract has not landed, so this branch holds only the part that does not depend on it: the input form. Request and response shapes are not invented here.

- `FE/src/deploy/SecretForm.tsx` is presentational. The parent supplies `onSubmit(entries)`, the set of keys the server already holds (`done`) and the set it said are missing (`missing`). The parent maps the real response onto those two sets once the contract exists.
- Values live in the component's state only. They are cleared after the server took them, kept after a failure so they can be sent again.
- Rules decided without a ruling in the issue: a blank value is not sent (client check, key named); `autoComplete="new-password"` so the browser does not fill or store them; a `503` shows "not your fault, try again later", any other failure shows a generic message, and neither echoes the server message.

## Todo

- [x] Input form: one password input per key with a reveal toggle, done keys shown by name, missing keys named, 503 retry keeps the values — files: `deploy/SecretForm.tsx`, `deploy/secrets.ts`
- [x] Tests: no value in storage, URL or console; missing key; 503 then resend
- [ ] Load the saved deploy (`GET /api/deploys/:id`), skip the step when no service has `secretKeys`, mount a route — needs a decision on the route path
- [ ] Submit through the #43 API and map the response onto `done` / `missing` — blocked on the api.md contract
- [ ] "Build ready" display from the #82 read API — blocked on the api.md contract
- [ ] Mutation testing (#67 not introduced yet; hand mutants on the decision logic were run)
- [ ] Screenshots (light and dark, 1440px and 390px) — attached by the user

## Done when

A user with a saved deploy can enter every `secretKeys` value, sees which keys are in or missing, and sees "build ready" from the server. This branch alone does not reach that.
