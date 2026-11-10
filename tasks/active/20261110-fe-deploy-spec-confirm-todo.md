# FE deploy settings edit and confirm screen (#71)

- **SRS**: no FR in `main` yet. Draft requirements are in open PR #89 (UC-04, FR-022 to FR-032), reference only.
- **Owner**: TaeTaeJin (FE session)
- **Branch**: feat/fe-deploy-spec-confirm

## Plan

Issue #71 is the scope: after `repos/check` and `repos/dockerfiles`, call `repos/deploy-spec` once with the commit from the check, show the draft as a pre-filled edit form, and save the confirmed values with `POST /api/deploys`. The contract is `docs/design/api.md` ("repos/deploy-spec", "배포 입력 저장").

- Conversion draft → spec lives in `FE/src/deploy/spec-form.ts` (pure functions, unit tested). The form state is all strings; `toSpec` makes the request body (null for empty values, never a missing key).
- Limits (slug 40, name 30, timeout 5..300, reserved slugs incl. `mail`, max 3 services) are in `FE/src/deploy/limits.ts` only. Slug 40, name 30, timeout 5..300 and `mail` are the values BE #80 will land; merged api.md still says 58 / 52 / 600.
- The same `{ path, code }` shape carries both the FE pre-check and the server `fields`, so one map draws the errors on the inputs. The server stays the authority.
- Edits clear the server errors (stale errors would stay on a field the user already fixed). Local checks re-run live after the first confirm attempt.
- Sized to one PR; the secret values (#83), the deploy button and the build status (#44) are out of scope.

## Todo

- [x] Keep `commit` from `repos/check`, show 7 characters, copy the full SHA — files: `DeployNewPage.tsx`, `deploy/CommitRef.tsx`
- [x] `deploy-spec` load and errors (503 retry, `COMMIT_NOT_FOUND` back to the check, ownership via `RepoFailureAlert`) — files: `deploy/DeployConfirm.tsx`
- [x] Pre-filled edit form with the source of each value — files: `deploy/SpecFormFields.tsx`, `deploy/spec-form.ts`, `components/ui/Select.tsx`
- [x] Empty `projects`, `truncated`, `commit: null` shown as facts
- [x] Field errors from `INVALID_SPEC.fields` by code; `SLUG_TAKEN` on the slug; `DATABASE_UNAVAILABLE` retry — files: `lib/api.ts` (`ApiError.fields`), `deploy/issues.ts`
- [x] Saved result with id, commit, services, secret names — files: `deploy/DeploySaved.tsx`
- [x] Tests with the code; docs touched (`ai-scope.md`, `design-system.md`)
- [ ] Screenshots (light and dark, 1440px and 390px) for the PR; browser check against a real BE
- [ ] Re-check the limits against merged api.md once BE #80 lands

## Done when

- [x] `pnpm verify` passes
- [ ] The flow works in a browser against the real BE and Supabase (not done: only fake responses so far)
- [ ] Mutation testing: not run
