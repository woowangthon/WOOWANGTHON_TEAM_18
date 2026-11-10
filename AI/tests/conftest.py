import pytest
from fastapi.testclient import TestClient
from pydantic import AnyHttpUrl, SecretStr

from ai_server.config import Settings
from ai_server.main import create_app

TOKEN = "t" * 32


@pytest.fixture
def settings() -> Settings:
    return Settings(
        _env_file=None,
        agent_api_token=SecretStr(TOKEN),
        gateway_url=AnyHttpUrl("http://platform:4000/mcp"),
    )


@pytest.fixture
def client(settings: Settings) -> TestClient:
    return TestClient(create_app(settings))
