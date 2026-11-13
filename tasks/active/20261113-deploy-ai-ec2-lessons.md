# Deploy the AI server on the platform EC2 — lessons

## Log

- 2026-11-13: Containers cannot reach each other's 127.0.0.1, so BE and AI share a user-defined docker network and call each other by container name; only the health ports are published, on 127.0.0.1.
- 2026-11-13: The rehearsal in this cloud session needed a `docker build` shim (host network, proxy CA, and the BE Dockerfile's `apt-get install ca-certificates` swapped for a CA copy, because deb.debian.org is blocked here). The scripts and Dockerfiles are unchanged; the EC2 has a normal network.
- 2026-11-13: shellcheck reports SC2016 (info) on the JMESPath query in single quotes, in both scripts; the backticks are JMESPath, not shell. The line is the same as on main.
- 2026-11-13: CodeRabbit, two findings taken in `deploy-ai.sh` only: the recovery of a stopped `wcp-ai-prev` now runs before the settings and the build and starts the container (it used to be after the build and only renamed it), and a `flock -n` lock stops a second run at once. `deploy-be.sh` has the same two gaps; left for a follow-up so this PR only adds the network there.
- 2026-11-13: On the EC2 (ec2-user) `wcp-ai` crashed with `PermissionError` on `/app/ai_server/__init__.py`: the non-root `tar` unpacked the build context under the script's `umask 077`, so the files were 0600 for the image's `app` user. The local rehearsal ran as root, whose `tar` keeps the archive modes. Reproduced as a non-root docker-group user (AI crash; BE `security/gitleaks.toml` and `package.json` 0600, unreadable to `node`), fixed with `(umask 022; tar -x ...)` in both scripts (`fix/deploy-umask`).

## Lessons

- `docker run --env-file f -e PORT=8000` gives PORT=8000: `-e` wins over the env file, so a stray PORT in SSM does not move the server.
- A recovery step has to run before anything that can fail, or the failure skips it.
- Rehearse a deploy as the same kind of user as production; root hides permission problems.
