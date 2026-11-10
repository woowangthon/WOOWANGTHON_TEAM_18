# BE project setup — lessons

## Log

- 2026-11-03: Planned the BE in conversation. Login changed from GitHub OAuth (ADR-001) to id/pw via Supabase Auth email + password, with GitHub linked to the account afterwards (`linkIdentity`) to check repo ownership; the admin account needs no GitHub link. That lands later (auth PR, then linking PR) with a new ADR; this PR is auth-free.
- 2026-11-04: Checked npm before scaffolding: `@nestjs/core` 12.3.2 is ESM-only, and the `@nestjs/schematics` 12 app template defaults to ESM + Vitest (the CJS variant keeps Jest + ts-jest, and ts-jest needs TypeScript <7). The earlier "Jest, because Vitest needs an SWC plugin for Nest" advice was out of date; the user chose Vitest.
- 2026-11-04: A throwaway spec (constructor injection with no `@Inject`) passed under Vitest 5 / Vite 8, so decorator metadata reaches DI with no SWC plugin.
- 2026-11-04: ESLint 9 printed "no longer supported". The FE stays on 9 only because `jsx-a11y` stops there; the BE has no such plugin and uses 10.
- 2026-11-04: `engines.node` = `^22.22.3 || ^24.15.0 || >=26.0.0`, the intersection of the lock's engines; `@nestjs/schematics` (pulled in by `@nestjs/cli`) is the narrowest. `node:22-bookworm-slim` ships 22.23.4.
- 2026-11-04: `nest build` compiles `tsconfig.build.json`, which leaves the tests out, so a type error in a test passed `verify`. Fixed by making `build` = `tsc --noEmit && nest build` (the FE's `tsc -b && vite build` shape) instead of a separate typecheck step in verify and CI.
- 2026-11-04: Hand-made mutants on `env.ts` / `app.setup.ts`: two survived, and both were equivalent (`origin: []` already allows nothing; an empty `CORS_ORIGINS` string is already filtered), so the redundant checks were removed rather than tested.
- 2026-11-04: `/simplify` (4 reviewers): applied — dropped CLI-default keys from `nest-cli.json`; dropped `moduleResolution` and `strict` (implied by `module: nodenext` / on by default in TS 6) and the incremental settings from `tsconfig`; renamed e2e files to `*.e2e.spec.ts` so Vitest's default pattern finds them and `vitest.config.ts` is gone; typed env values as strings and used `URL.parse`; moved the typecheck into `build`. Skipped — `"version"` in `package.json` (kept like FE), sharing ESLint/workflow config with FE (separate lockfiles; revisit when AI is a third copy), Docker/CI micro-optimizations. One reuse finding (missing `cache-dependency-path` in `be.yml`) was wrong — it is there.
- 2026-11-04: `/code-review` at low effort (the level carried over from the FE PRs): no findings. Each commit re-verified on its own after the history rebuild; CI steps also re-run in a `node:22-bookworm-slim` container (all exit 0).
- 2026-11-04: Opened #26. This time the fork PR did trigger the workflows (FE and BE both green). CodeRabbit left 2 minor comments: the CLAUDE.md Node range read as allowing 23/25 → fixed; "revert the SRS change until Notion is synced" → kept, with the reason in the thread (#23/#24 precedent, CONTRIBUTING §2) and the Notion sync left as a merge condition. Then marked OPS-02 as passed in GitHub CI.

## Lessons

- Read the framework's current template before recommending its tooling; "Nest means Jest" was true for Nest ≤11 and wrong for 12.
- When the build compiles a narrower tsconfig than the tests use, put the type check inside `build` so `verify` and CI cannot drift apart.
- A surviving mutant is sometimes dead code: if the mutant behaves the same, delete the code instead of adding a test.
- Manual mutation scripts must restore the file in a `finally`; a failed backup step left mutants stacked in the tree once (caught and redone).
