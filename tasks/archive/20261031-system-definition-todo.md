# System definition

- **SRS**: none yet (SRS UC/FR are still empty; this task writes the structure SSOT the SRS will point to)
- **Owner**: TaeTaeJin
- **Branch**: docs/system-definition

## Plan

PR #8 merged the seven architecture diagrams. This task writes `docs/system-definition.md` from them: users, components and responsibilities, stack, per-user flows, infra, defaults and open questions. Until the SRS is updated, **the system definition is the source of truth**; the SRS, `.coderabbit.yaml` and `docs/conventions.md` follow in a separate PR.

Scope of this PR (kept minimal because of the "change and the doc it affects go in the same PR" rule): `docs/system-definition.md`, the diagrams it embeds, `docs/ai-scope.md` (new AI features and external tech), `docs/adr/001-*` and `002-*` (+ README), the `CLAUDE.md` doc routing and directory layout.

The MVP scope was cut once more without touching the core path (deploy -> review/approve -> run -> student control and observation -> operator approval and status). Cut items moved below the "core" line as add-on features, not deleted: infra-view details, project-hub details, student "restore DB" button, user management, Playground management. The cost estimate stays in the core but is only "price table + usage metrics -> AI -> rough monthly estimate".

## Todo

- [x] Write `docs/system-definition.md` (users, components, Kafka scope, glossary, repo layout, leader migration, flows 4.1-4.4, infra, defaults, open questions)
- [x] Review round: 8 read-only review agents + code-review + simplify; fix the high and medium findings
- [x] Align the diagrams with the document (deploy.status removed, MySQL only, domain 11/11, cost estimate AWS-only, Playground default public)
- [x] Update `ai-scope.md` (MySQL, Traefik, Vite, scanner candidate, "AI not applied" rows, domain limit)
- [x] Add the repo directory layout (`FE/ BE/ AI/ Infra/`) and drop the `apps/` references in the files of this PR (`.coderabbit.yaml` and `docs/conventions.md` still have them and go in the follow-up PR)

## Done when

- [x] every relative link and anchor in `docs/system-definition.md` resolves; table column counts match
- [x] no leftover "apps/" in this PR's files, no "deploy.status", "도메인 없음", e-mail alerts or "(설계만)" on a core feature in the document or the six edited diagrams
- [x] each edited SVG embeds exactly one tab and keeps its tab name
- [x] the document and the six edited diagrams agree on Kafka events, DB choice, domain, cost estimate, Playground default, spike handling and the core / add-on split (checked by a final read-only review)
- [x] the committed files are exactly the ones listed in Plan; SRS, `.coderabbit.yaml` and `docs/conventions.md` are left out
