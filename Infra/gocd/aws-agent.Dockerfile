# The AWS executor: a GoCD agent that runs the Build stage (docs/design/platform-hosting.md "GoCD 서버 · AWS 실행기").
# It needs node (Infra/pipeline), pnpm (through corepack, the version is pinned in Infra/pipeline/package.json; only pnpm is
# enabled because the node image's yarn link points outside the copied folder) and the
# aws CLI (the Build stage calls CodeBuild with it). Bump the node tag together with Infra/executor/agent.yaml and
# the agent version together with the server's (compose.yaml).
FROM node:24.15.0-bookworm-slim AS node

FROM gocd/gocd-agent-debian-12:v26.1.0
USER root
COPY --from=node /usr/local /opt/node
ENV PATH=/opt/node/bin:$PATH
# Debian 12's own awscli package (AWS CLI v2). No installer is downloaded at build time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends awscli \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable pnpm
USER go
