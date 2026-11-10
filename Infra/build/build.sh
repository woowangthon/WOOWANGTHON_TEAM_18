#!/usr/bin/env bash
# 학생 서비스 하나의 이미지를 만들어 검사하고 GHCR에 push한다. CodeBuild에서 buildspec.yml이 부른다.
# 설계: docs/design/deploy-workflow.md W4 · §8, docs/design/deploy-handoff.md.
#
# 입력 env (모두 공개 값, 파이프라인이 StartBuild로 넘긴다. 값이 없는 칸은 오지 않는다):
#   SOURCE_REPO SOURCE_COMMIT       학생 레포 owner/name과 빌드할 commit
#   BUILD_CONTEXT DOCKERFILE        docker build 컨텍스트, 학생 Dockerfile(레포 루트 기준. 없으면 기본 Dockerfile)
#   FRAMEWORK APP_DIR NODE_VERSION INSTALL_CMD BUILD_CMD START_CMD OUTPUT_DIR   기본 Dockerfile의 빌드 값
#   BUILD_ENV_B64                   buildEnv의 K=V를 NUL로 이어 base64로 싼 것
#   IMAGE_REPO IMAGE_TAG            push할 곳
#   GHCR_USER GHCR_TOKEN_SECRET_ID  push 계정과, 토큰이 든 Secrets Manager 비밀의 이름(값이 아니다)
# 출력: /tmp/image-digest(DIGEST_FILE)에 `ghcr.io/...@sha256:...`
#
# 실패 이유를 플랫폼이 코드로 가를 수 있게 플랫폼 쪽 실패는 `PLATFORM_ERROR <코드>` 줄을 남긴다(AI 에이전트를 부르지 않는 실패).
set -euo pipefail

# 이미지 크기 상한. 이보다 크면 노드가 받는 데 오래 걸리고 디스크를 많이 쓴다.
MAX_IMAGE_BYTES=$((2 * 1024 * 1024 * 1024))
PLATFORM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(mktemp -d)/src"
# buildspec.yml이 읽는 곳. 테스트만 바꾼다.
DIGEST_FILE="${DIGEST_FILE:-/tmp/image-digest}"
IMAGE="${IMAGE_REPO}:${IMAGE_TAG}"

platform_error() {
  echo "PLATFORM_ERROR $1"
  exit 1
}

# 1. 학생 레포를 commit 하나만 받는다. 공개 레포만 받는다(자격 증명 없음).
git init -q "$SRC"
git -C "$SRC" fetch -q --depth 1 "https://github.com/${SOURCE_REPO}.git" "$SOURCE_COMMIT" || platform_error SOURCE_FETCH
git -C "$SRC" checkout -q FETCH_HEAD

# 2. docker build 안에서 도는 학생 코드가 CodeBuild 자격 증명(링크 로컬 주소의 메타데이터 · 자격 증명 엔드포인트)에 닿지 못하게 막는다.
#    빌드 컨테이너는 docker 브리지로 나가므로 DOCKER-USER 체인에 막는 규칙을 넣는다. 막지 못하면 빌드하지 않는다.
iptables -I DOCKER-USER -d 169.254.0.0/16 -j DROP 2>/dev/null || iptables -I FORWARD -d 169.254.0.0/16 -j DROP || platform_error METADATA_BLOCK

# 3. 빌드. 학생 Dockerfile이 있으면 그것으로, 없으면 프레임워크의 기본 Dockerfile과 빌드 값으로.
args=()
if [ -n "${BUILD_ENV_B64:-}" ]; then
  while IFS= read -r -d '' kv; do args+=(--build-arg "$kv"); done < <(printf '%s' "$BUILD_ENV_B64" | base64 -d; printf '\0')
fi
if [ -n "${DOCKERFILE:-}" ]; then
  dockerfile="$SRC/$DOCKERFILE"
else
  dockerfile="$PLATFORM_DIR/dockerfiles/${FRAMEWORK}.Dockerfile"
  args+=(--build-arg "NODE_VERSION=${NODE_VERSION}" --build-arg "APP_DIR=${APP_DIR}" --build-arg "INSTALL_CMD=${INSTALL_CMD}" --build-arg "BUILD_CMD=${BUILD_CMD}")
  args+=(--build-arg "START_CMD=${START_CMD:-}" --build-arg "OUTPUT_DIR=${OUTPUT_DIR:-}" --build-arg "BUILD_ENV_B64=${BUILD_ENV_B64:-}")
fi
DOCKER_BUILDKIT=1 docker build --pull -f "$dockerfile" -t "$IMAGE" "${args[@]}" "$SRC/$BUILD_CONTEXT"

# 4. 이미지 검사 (규칙): 크기 상한, root로 실행하면 경고만.
size="$(docker image inspect --format '{{.Size}}' "$IMAGE")"
if [ "$size" -gt "$MAX_IMAGE_BYTES" ]; then
  echo "IMAGE_TOO_LARGE ${size} bytes > ${MAX_IMAGE_BYTES} bytes"
  exit 1
fi
user="$(docker image inspect --format '{{.Config.User}}' "$IMAGE")"
if [ -z "$user" ] || [ "$user" = root ] || [ "$user" = 0 ]; then
  echo "WARNING IMAGE_RUNS_AS_ROOT"
fi

# 5. push. 토큰은 학생 코드가 끝난 뒤 이 단계에서만 꺼내고 파일 · 로그에 남기지 않는다.
aws secretsmanager get-secret-value --secret-id "$GHCR_TOKEN_SECRET_ID" --query SecretString --output text \
  | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null || platform_error GHCR_LOGIN
docker push -q "$IMAGE" >/dev/null || platform_error GHCR_PUSH
docker logout ghcr.io >/dev/null

digest="$(docker image inspect --format '{{index .RepoDigests 0}}' "$IMAGE")"
case "$digest" in
  "${IMAGE_REPO}@sha256:"*) printf '%s' "$digest" > "$DIGEST_FILE" ;;
  *) platform_error NO_IMAGE_DIGEST ;;
esac
echo "pushed ${IMAGE} as ${digest}"
