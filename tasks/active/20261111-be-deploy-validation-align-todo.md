# BE deploy input validation: align numbers and cross-service rules with deploy-handoff.md (#77)

- **SRS**: none (follow-up of [#76](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/76); issue [#80](https://github.com/woowangthon/WOOWANGTHON_TEAM_18/issues/80))
- **Owner**: TaeTaeJin
- **Branch**: feat/be-deploy-validation-align

## Plan

W4 re-checks a deploy input with the rules in `docs/design/deploy-handoff.md` ("검증 규칙", PR #77, still open). If BE accepts more, an input can be saved and then rejected at build. Decided with the infra owner (2026-11-10): where the numbers differ, BE follows #77.

Changes: slug 1~40, service name 1~30, `startupTimeoutSeconds` 5~300, at most one service per `role`, no identical `ingressPath` between services (`null` excluded; same string only, prefix overlap is not checked), the reserved slugs follow `cluster.md` §9. `docs/design/api.md` follows (numbers, the `-candidate` wording becomes slot names `<name>-a` / `<name>-b`).

Not changed: a service name still starts with a lowercase letter, `resources` accepts only `null`, the migration is not edited (its slug check `{0,56}` is wider than 40 and the server validates first).

## Todo

- [x] Limits and reserved list in the validator; boundary rows in the table tests — files: `BE/src/deploys/deploy-input.ts`, `.spec.ts`
- [x] `DUPLICATE` on the later service's `role` and `runtime.ingressPath` — same files
- [x] `docs/design/api.md` table, numbers and slot-name wording
- [x] Mutation testing: no mutation tool is set up for BE (#67), so 23 hand-made mutants on the changed lines were run against `deploy-input.spec.ts`: 22 killed, 1 equivalent (an invalid cell is already reported at that path, and one code per path is kept)
- [x] `/code-review low` and `/simplify` run once; simplify findings applied (shared `unique` helper, `addService` test helper, stale comment, one repeated number)

## Done when

- [ ] `pnpm verify` result known and reported
- [ ] #77 changes are re-checked before the PR (values assumed from the PR head `cb17c5a`)
