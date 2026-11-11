# BE: connect to the leader's k8s API and create the student space — lessons

## Log

- 2026-11-11: Started from `upstream/main` (41a72aa). The issue lists four objects; the infra owner's second comment on it adds the RoleBinding `platform-server-read` as the fifth, created last. Followed the comment.
- 2026-11-11: Env names follow the cluster owner (`K8S_API_URL`, `K8S_TOKEN`, `K8S_CA_CERT`); the CA is base64 of the PEM because EC2's `docker --env-file` allows one line per variable.
- 2026-11-11: Global `fetch` cannot take a CA per request (needs `undici`), so the client uses `node:https`. Tests make a CA and a server certificate with `openssl` in `beforeAll` instead of committing a key.

## Lessons

- A value compared as a substring or one-way against the yaml (`4`, `53`) passes by accident; compare whole lines and compare both directions. The first drift test let five template mutants survive.
- `URL.hostname` keeps the brackets of an IPv6 address; `http.request` needs them stripped. The cluster's Tailscale address can be IPv6.
- The deploy target's env file takes one line per variable, so a PEM goes in as base64 (`K8S_CA_CERT`). Ask where the setting lives before choosing the format.
