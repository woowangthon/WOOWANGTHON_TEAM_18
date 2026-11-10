# syntax=docker/dockerfile:1
# 플랫폼 기본 Dockerfile: vite-react. 학생 레포에 Dockerfile이 없을 때 배포 입력의 빌드 값으로 빌드한다(Infra/build/build.sh가 build arg로 넘긴다).
# 정적 파일: 빌드 결과 폴더(OUTPUT_DIR, APP_DIR 기준)를 nginx(root가 아닌 사용자, 8080)로 서빙한다. 없는 경로는 index.html(SPA).
# 이 파일을 바꾸면 versions.json의 sha256과, version을 올려 BE의 DEFAULT_DOCKERFILE_VERSIONS를 같이 고친다(테스트가 셋을 대조한다).
# 버전을 올리지 않으면 바뀌기 전 Dockerfile로 만든 이미지를 빌드 캐시가 그대로 다시 쓴다.
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# pnpm · yarn 명령이 그대로 돌게 corepack을 켠다(package.json의 packageManager 버전을 쓴다). Node 25부터는 corepack이 들어 있지 않아 받는다.
RUN (command -v corepack >/dev/null || npm install -g corepack) && corepack enable
# buildEnv(BUILD_ENV_B64: K=V를 NUL로 이어 base64로 싼 것)를 env로 얹어 명령을 돌린다. 키가 정해져 있지 않아 ARG로 선언할 수 없다.
COPY <<'EOF' /usr/local/lib/with-build-env.mjs
import { spawnSync } from 'node:child_process'
const env = { ...process.env }
for (const kv of Buffer.from(process.env.BUILD_ENV_B64 ?? '', 'base64').toString().split('\0').filter(Boolean)) {
  const i = kv.indexOf('=')
  env[kv.slice(0, i)] = kv.slice(i + 1)
}
delete env.BUILD_ENV_B64
const [cmd, ...args] = process.argv.slice(2)
process.exit(spawnSync(cmd, args, { stdio: 'inherit', env }).status ?? 1)
EOF
WORKDIR /app
COPY . .
ARG APP_DIR=.
ARG INSTALL_CMD
ARG BUILD_CMD
ARG BUILD_ENV_B64=
WORKDIR /app/${APP_DIR}
RUN sh -c "$INSTALL_CMD"
RUN node /usr/local/lib/with-build-env.mjs sh -c "$BUILD_CMD"

FROM nginxinc/nginx-unprivileged:1.27-alpine
ARG APP_DIR=.
ARG OUTPUT_DIR
COPY --from=build /app/${APP_DIR}/${OUTPUT_DIR} /usr/share/nginx/html
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
  listen 8080;
  root /usr/share/nginx/html;
  location / {
    try_files $uri $uri/ /index.html;
  }
}
EOF
