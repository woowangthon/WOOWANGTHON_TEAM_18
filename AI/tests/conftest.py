from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pydantic import AnyHttpUrl, SecretStr

from ai_server.config import Settings
from ai_server.main import create_app

TOKEN = "t" * 32
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def settings() -> Settings:
    return Settings(
        _env_file=None,
        agent_api_token=SecretStr(TOKEN),
        gateway_url=AnyHttpUrl("http://platform:4000/mcp"),
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    # with 블록 안에서는 요청 사이에 이벤트 루프가 이어져 백그라운드 실행이 살아 있다.
    with TestClient(create_app(settings)) as c:
        yield c
