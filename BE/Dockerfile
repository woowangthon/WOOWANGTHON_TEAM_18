# syntax=docker/dockerfile:1
# 빌드 컨텍스트는 BE/ (`docker build -t be BE`). 운영(EC2)도 이 이미지를 쓴다(Infra/aws/deploy-be.sh).

FROM node:22-bookworm-slim AS build
# pnpm 버전은 package.json의 packageManager에서 읽는다.
RUN corepack enable
WORKDIR /app

# 의존성 층: 소스가 바뀌어도 package.json과 lockfile이 같으면 설치를 다시 하지 않는다.
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
# 빌드 뒤 개발 의존성을 지워 실행 단계에는 운영 의존성만 넘긴다.
RUN pnpm build && pnpm prune --prod

# 보안 검사(UC-10) 도구. 버전과 sha256을 고정한다(각 릴리스의 checksums 파일 값). x86_64(EC2 m7i-flex)만.
FROM node:22-bookworm-slim AS scanners
ADD --checksum=sha256:551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb \
    https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz /tmp/gitleaks.tar.gz
ADD --checksum=sha256:c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0 \
    https://github.com/aquasecurity/trivy/releases/download/v0.76.1/trivy_0.76.1_Linux-64bit.tar.gz /tmp/trivy.tar.gz
RUN mkdir /out && tar -xzf /tmp/gitleaks.tar.gz -C /out gitleaks && tar -xzf /tmp/trivy.tar.gz -C /out trivy
# slim 이미지에는 시스템 CA가 없다. trivy(Go)가 DB를 받을 때 쓴다(node는 자기 CA 목록을 쓴다).
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

FROM node:22-bookworm-slim
WORKDIR /app
# 검사 도구와 우리 gitleaks 설정. Trivy 취약점 DB는 이미지에 넣지 않는다(약 1.7GB): Infra/aws/deploy-be.sh가 받아 읽기 전용으로 붙인다.
COPY --from=scanners /out/gitleaks /out/trivy /usr/local/bin/
COPY --from=scanners /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY security ./security
# package.json은 "type": "module" 때문에 필요하다.
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
