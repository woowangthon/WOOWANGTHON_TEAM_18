# FE secret value input screen (#83)

- **SRS**: UC-04 follow-up (W3, secret values). No FR number checked in `main` yet.
- **Owner**: TaeTaeJin (FE session)
- **Branch**: feat/fe-secret-inputs

## Plan

Built against the BE contract in `docs/design/api.md` "비밀값" (BE branch `feat/be-secrets`, commit 2cd9432, not merged yet).

- `GET /api/deploys/:id/secrets` reads the state, `PUT` with `{ services: { <svc>: { KEY: value } } }` writes it. The server reports state per service (`in` / `missing`), and a service is sent with all its keys, so the form keeps state per service, not per key.
- `FE/src/deploy/DeploySecrets.tsx` loads the state, applies the PUT response, re-reads after a failed PUT (services are written one after another, so an earlier one may be in), and shows "빌드 준비됨" from `ready`. A deploy with no secret keys says the step is skipped.
- `FE/src/deploy/SecretForm.tsx` is the form: one password input per key, done services show only key names, "값 바꾸기" re-opens a done service (all its keys again), `400 INVALID_SECRETS` field paths (`secrets.<svc>.<KEY>`) map to the input, anything else is a generic "not saved" notice that never echoes the server message or the values.
- Route `/deploys/:id/secrets` (`pages/DeploySecretsPage.tsx`), linked from the saved screen (`DeploySaved.tsx`).
- `apiFetch` takes an optional method (`'POST' | 'PUT'`) for the PUT.

## Todo

- [x] Input form, per-service state, value reset on success, kept on failure
- [x] Load state, PUT, midway-failure re-read, "build ready", no-secrets deploy
- [x] Route and link from the saved screen
- [x] Tests, including no leak to storage, URL or console
- [x] Hand mutants on the decision logic (PUT method, re-read, 404, ready, empty, path root, done, grouping)
- [ ] Mutation testing (#67 not introduced yet)
- [ ] Link to the progress screen when `NOT_READY` comes back from start (#99 / #104 may not be merged; do after both land)
- [ ] Screenshots (light and dark, 1440px and 390px) — attached by the user
- [ ] A real round trip against the BE (needs `feat/be-secrets` merged and its migration applied)

## Done when

A user with a saved deploy can enter every `secretKeys` value, sees which services are in, and sees "빌드 준비됨" from the server.
