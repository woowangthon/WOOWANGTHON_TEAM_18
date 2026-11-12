# LOCAL TEST ONLY. Stands in for the leader executor (resource `leader`) on a developer machine so the Prepare, Render and
# Apply stages can be run against a cluster you can reach. The real one is the Pod in Infra/executor/agent.yaml; never run
# this image next to it or on the EC2 (two agents with the same resource would take each other's jobs).
# Same tools as the Pod's init containers: node 24 and helm.
FROM node:24.15.0-bookworm-slim AS node
FROM alpine/helm:3.22.1 AS helm

FROM gocd/gocd-agent-debian-12:v26.1.0
USER root
COPY --from=node /usr/local /opt/node
COPY --from=helm /usr/bin/helm /usr/local/bin/helm
ENV PATH=/opt/node/bin:$PATH
RUN corepack enable pnpm
USER go
