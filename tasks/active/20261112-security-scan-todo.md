# Security scan (UC-10, #45): gitleaks · Trivy in the platform server

- **SRS**: FR-066, FR-095, FR-096, FR-097
- **Owner**: TaeTaeJin
- **Branch**: feat/be-security-scan

## Plan

ADR-010: the platform server scans the confirmed commit with deterministic tools; the result is a warning, never a blocker.
Saving a deploy input (`POST /api/deploys`) queues a scan of its repo · commit (one at a time, one per commit). The server
downloads the commit tar.gz (public, no auth, size limits), unpacks it read-only, runs gitleaks and Trivy without the
server env and without the repo's own settings, and stores only locations in `security_scans`. The status read
(`GET /api/deploys/:id/status`) turns them into `warnings`; FE already shows them. Trivy's DB (~1.7GB) is refreshed by
`Infra/aws/deploy-be.sh` and mounted read-only; no request downloads it.

Left out on purpose: removing a committed `.env` from the build (Vite apps commit public `VITE_*` values; removing
it would break them), attaching warnings to an open problem ticket (changes the AI server ticket contract),
secrets in deleted history (needs a clone; already out of the MVP in #45).

## Todo

- [x] migration `security_scans` — `supabase/migrations/20261112000000_create_security_scans.sql`
- [x] findings → warnings (pure) — `BE/src/security/findings.ts`
- [x] fetch · unpack · tools — `BE/src/security/source-scanner.ts`, `BE/security/gitleaks.toml`
- [x] queue · stored state · warnings for a deploy — `BE/src/security/security-scan.service.ts`, `BE/src/deploys/deploys.store.ts`
- [x] wire into save and status — `deploys.service.ts`, `deploy-runs.service.ts`, `deploys.module.ts`, `config/env.ts` (`TRIVY_CACHE_DIR`)
- [x] image and deploy — `BE/Dockerfile` (pinned versions + sha256, CA bundle), `Infra/aws/deploy-be.sh` (DB refresh, ro mount)
- [x] docs — `api.md` warnings, `ai-scope.md`, `platform-hosting.md`
- [ ] EC2: apply the migration, redeploy, check disk, see warnings on a real deploy

## Done when

- [x] unit + e2e tests: parsing drops secret values, order · cap · service mapping, one-at-a-time queue, stale running, env isolation, size limit, tool failure → `SCAN_FAILED`, status still 200 when the record cannot be read
- [x] the real BE image scans a public repo in a container (local docker)
- [ ] a deploy on app.stairnoworks.com shows the warnings
