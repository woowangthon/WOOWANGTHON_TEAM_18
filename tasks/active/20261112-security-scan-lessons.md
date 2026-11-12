# Security scan (UC-10, #45) — lessons

## Log

- 2026-11-12: picked gitleaks v8.30.1 (2026-03-21) and Trivy v0.76.1 (2026-10-21), both older than two weeks; sha256 from each release's checksums file.
- 2026-11-12: `gitleaks:allow` comments let a repo hide a secret; `--ignore-gitleaks-allow` turns that off (checked with the real binary). `--config` beats the repo's `.gitleaks.toml`; `.gitleaksignore` is left out when unpacking.
- 2026-11-12: Trivy reads `trivy.yaml` and `.trivyignore` from the working folder by default; `--config ''` and `--ignorefile ''` turn both off. Trivy runs fine on a read-only DB folder with `--skip-db-update --offline-scan --cache-backend memory`.
- 2026-11-12: the Trivy DB is ~1.7GB unpacked, so it stays out of the image and lives in a host folder.
- 2026-11-12: the first container test failed: `node:22-bookworm-slim` has no system CA bundle, so trivy (Go) could not download its DB (`x509: certificate signed by unknown authority`). Node's own fetch was fine. Copied `ca-certificates.crt` from a stage that installs it.
- 2026-11-12: local container scan of OWASP/NodeGoat: 3 secrets, 60 HIGH/CRITICAL vulnerabilities, ~1s; whole container peak memory ~100MB (cgroup v1 `memory.max_usage_in_bytes`).

## Lessons

- A Go binary in a slim Node image needs the CA bundle; test any tool that talks TLS inside the real image, not on the host.
- Fake low-entropy tokens (`ghp_aBcDeF...0123456789`) are not found by gitleaks; use realistic random-looking values in fixtures.
