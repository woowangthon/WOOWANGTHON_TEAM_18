# BE: connect to the leader's k8s API and create the student space — lessons

## Log

- 2026-11-11: Started from `upstream/main` (41a72aa). The issue lists four objects; the infra owner's second comment on it adds the RoleBinding `platform-server-read` as the fifth, created last. Followed the comment.
- 2026-11-11: Global `fetch` cannot take a CA per request (needs `undici`), so the client uses `node:https`. Tests make a CA and a server certificate with `openssl` in `beforeAll` instead of committing a key.

## Lessons

<filled when done>
