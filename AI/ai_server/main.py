from fastapi import FastAPI

from ai_server.config import Settings


def create_app(settings: Settings) -> FastAPI:
    # 내부 망에서만 여는 서버라 API 문서를 내보내지 않는다(스키마가 없으면 /docs · /redoc도 없다).
    app = FastAPI(title="AI server", openapi_url=None)
    app.state.settings = settings

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
