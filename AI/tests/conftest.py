import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pydantic import AnyHttpUrl, SecretStr

from ai_server.agent.memory import CaseMemory
from ai_server.agent.runs import TicketRun
from ai_server.config import Settings
from ai_server.main import create_app

# PydanticAI가 첫 실행에 찍는 관측 도구 안내문을 끈다.
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

TOKEN = "t" * 32
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def settings() -> Settings:
    return Settings(
        _env_file=None,
        agent_api_token=SecretStr(TOKEN),
        gateway_url=AnyHttpUrl("http://platform:4000/mcp"),
        local_model_url=AnyHttpUrl("http://vllm:8000/v1"),
        local_model_name="Qwen/Qwen3-8B-AWQ",
    )


async def classify_only(run: TicketRun, memory: CaseMemory) -> None:
    """API 테스트용 실행: 코드 분류만 하고 끝난다(모델 · 게이트웨이에 닿지 않는다)."""
    case = memory.classify(run.ticket)
    run.case_id = case.case_id if case else None


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    # with 블록 안에서는 요청 사이에 이벤트 루프가 이어져 백그라운드 실행이 살아 있다.
    with TestClient(create_app(settings, runner=classify_only)) as c:
        yield c
