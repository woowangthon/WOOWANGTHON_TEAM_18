# syntax=docker/dockerfile:1
# 빌드 컨텍스트는 FE/ (`docker build -t fe FE`). 운영 배포는 S3 + CloudFront라 이 이미지는 로컬 컨테이너 개발용이다.

FROM node:22-bookworm-slim AS build
# pnpm 버전은 package.json의 packageManager에서 읽는다.
RUN corepack enable
WORKDIR /app

# 의존성 층: 소스가 바뀌어도 package.json과 lockfile이 같으면 설치를 다시 하지 않는다.
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
