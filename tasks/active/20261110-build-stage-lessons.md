# Build stage (W4) — lessons

## Log

- 2026-11-10: The design said "build → image check → push" without saying what the check is. Asked the coordination session (rule check / Trivy blocking / Trivy report only); the user chose the rule check (image built, size ≤ 2 GiB, root only warned). Vulnerability scanning stays in W1 (ADR-010).
- 2026-11-10: CodeBuild cannot take the platform's files from the student repo, so the buildspec is passed inline and fetches both repos itself (`NO_SOURCE`). No CodeBuild GitHub connection is needed for public repos.
- 2026-11-10: `buildEnv` keys are not known ahead, so the default Dockerfiles cannot declare them as `ARG`. They travel as one base64 NUL-joined arg and a small node wrapper puts them in the build command's env only.
- 2026-11-10: Local docker: Docker Hub answered 429; `mirror.gcr.io` served the same images. pnpm through corepack failed inside the container on the sandbox proxy's certificate, so the local run used npm.
- 2026-11-10: Hand-made mutants: 16 run, 15 killed. Survivor: `build === 'run'` → `build !== 'reuse'`, equivalent because `parseDeployInput` only lets `run` and `reuse` through.

## Lessons

- A test that hashes the default Dockerfiles against a lock file and the BE version constant is the cheapest guard against the build cache serving images built from an old Dockerfile.
