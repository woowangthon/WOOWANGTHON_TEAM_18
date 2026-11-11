from fastapi import FastAPI

from ai_server.agent.api import build_router
from ai_server.agent.loop import runner_from_settings
from ai_server.agent.memory import CaseMemory, load_cases
from ai_server.agent.runs import Runner, RunRegistry
from ai_server.config import Settings


def create_app(settings: Settings, runner: Runner | None = None) -> FastAPI:
    # 내부 망에서만 여는 서버라 API 문서를 내보내지 않는다(스키마가 없으면 /docs · /redoc도 없다).
    app = FastAPI(title="AI server", openapi_url=None)
    app.state.settings = settings
    if runner is None:
        runner = runner_from_settings(settings)
    runs = RunRegistry(CaseMemory(load_cases()), runner, settings.agent_max_runs)
    app.state.runs = runs

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(build_router(settings, runs))
    return app
