# syntax=docker/dockerfile:1
# 빌드 컨텍스트는 BE/ (`docker build -t be BE`). 운영 배포는 EC2라 이 이미지는 로컬 컨테이너 개발용이다.

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

FROM node:22-bookworm-slim
WORKDIR /app
# package.json은 "type": "module" 때문에 필요하다.
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
