# syntax=docker/dockerfile:1
# 빌드 컨텍스트는 AI/ (`docker build -t ai AI`). 운영 배포는 EC2이고, 이 이미지로 띄운다.

FROM python:3.12-slim-bookworm AS build
# uv는 빌드 단계에만 둔다. 버전은 CI(ai.yml)와 같게 손으로 맞춘다.
RUN pip install --no-cache-dir uv==0.11.32
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
# 의존성 층: 소스가 바뀌어도 pyproject.toml과 uv.lock이 같으면 설치를 다시 하지 않는다. 개발 의존성은 넣지 않는다.
COPY pyproject.toml uv.lock .python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project
COPY ai_server ./ai_server

FROM python:3.12-slim-bookworm
WORKDIR /app
COPY --from=build /app /app
# PYDANTIC_AI_NO_BANNER: 첫 에이전트 실행 때 찍히는 관측 도구 안내문을 끈다.
ENV PATH="/app/.venv/bin:$PATH" HOST=0.0.0.0 PYTHONUNBUFFERED=1 PYDANTIC_AI_NO_BANNER=1
# root가 아닌 사용자로 실행한다.
RUN useradd --system --uid 10001 app
USER app
EXPOSE 8000
CMD ["python", "-m", "ai_server"]
