# Deploy the AI server on the platform EC2 — lessons

## Log

- 2026-11-13: Containers cannot reach each other's 127.0.0.1, so BE and AI share a user-defined docker network and call each other by container name; only the health ports are published, on 127.0.0.1.
- 2026-11-13: The rehearsal in this cloud session needed a `docker build` shim (host network, proxy CA, and the BE Dockerfile's `apt-get install ca-certificates` swapped for a CA copy, because deb.debian.org is blocked here). The scripts and Dockerfiles are unchanged; the EC2 has a normal network.
- 2026-11-13: shellcheck reports SC2016 (info) on the JMESPath query in single quotes, in both scripts; the backticks are JMESPath, not shell. The line is the same as on main.

## Lessons

- `docker run --env-file f -e PORT=8000` gives PORT=8000: `-e` wins over the env file, so a stray PORT in SSM does not move the server.
