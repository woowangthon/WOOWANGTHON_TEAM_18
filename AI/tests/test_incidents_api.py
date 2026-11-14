from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.models import Model

from ai_server.agent.incident import Judges, ModelName, judges_from_settings
from ai_server.agent.redact import RedactingModel
from ai_server.config import Settings
from ai_server.main import create_app
from tests.conftest import AUTH, classify_only
from tests.scripted import Script, fail, final

JUDGMENT = {
    "risk": "high",
    "recommendation": "stop",
    "cause": "시작하자마자 포트 오류로 죽습니다.",
    "reason": "재시작 12회, 로그에 EADDRINUSE가 있습니다.",
}


def body(**over: Any) -> dict[str, Any]:
    return {
        "incidentId": "inc-1",
        "slug": "my-app",
        "alertname": "KubePodNotReady",
        "summary": "Pod has been in a non-ready state for more than 15 minutes.",
        "labels": {"namespace": "proj-my-app", "pod": "be-a-123"},
        "pods": [
            {
                "name": "be-a-123",
                "phase": "Running",
                "ready": False,
                "restarts": 12,
                "waiting": None,
            }
        ],
        "logs": ["listening on 3000", "Error: listen EADDRINUSE :::3000"],
        **over,
    }


@contextmanager
def client_with(*order: tuple[ModelName, Model]) -> Iterator[TestClient]:
    settings = Settings(
        _env_file=None,
        agent_api_token="t" * 32,
        gateway_url="http://platform:4000/mcp",
    )
    judges = Judges(list(order))
    with TestClient(create_app(settings, runner=classify_only, judges=judges)) as c:
        yield c


def post(c: TestClient, payload: Any, headers: dict[str, str] = AUTH) -> Any:
    return c.post("/agent/incidents", json=payload, headers=headers)


def test_local_model_judges_first() -> None:
    local = Script(final(**JUDGMENT))
    planner = Script()
    with client_with(("local", local.model), ("planner", planner.model)) as c:
        res = post(c, body())
    assert res.status_code == 200
    assert res.json() == {**JUDGMENT, "model": "local"}
    assert planner.requests == []
    # 모델에 간 글에 경고 · Pod · 오류 로그 줄이 들어 있다.
    sent = local.sent()
    assert "KubePodNotReady" in sent and "EADDRINUSE" in sent and '"restarts": 12' in sent


def test_planner_answers_when_the_local_model_fails() -> None:
    local = Script(fail(RuntimeError("vllm down")))
    planner = Script(final(**JUDGMENT))
    with client_with(("local", local.model), ("planner", planner.model)) as c:
        res = post(c, body())
    assert res.status_code == 200
    assert res.json()["model"] == "planner"


def test_bad_output_from_the_local_model_falls_to_the_planner() -> None:
    bad = {**JUDGMENT, "recommendation": "delete-everything"}
    # 출력 재시도(2회)까지 모두 틀린 모양이면 다음 모델로 넘어간다.
    local = Script(final(**bad), final(**bad), final(**bad))
    planner = Script(final(**JUDGMENT))
    with client_with(("local", local.model), ("planner", planner.model)) as c:
        res = post(c, body())
    assert res.json()["model"] == "planner"
    assert local.done


def test_503_when_no_model_can_judge() -> None:
    local = Script(fail(RuntimeError("down")))
    planner = Script(fail(RuntimeError("down")))
    with client_with(("local", local.model), ("planner", planner.model)) as c:
        res = post(c, body())
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "MODEL_UNAVAILABLE"


def test_503_when_no_model_is_configured() -> None:
    with client_with() as c:
        res = post(c, body())
    assert res.status_code == 503


def test_planner_never_sees_a_secret_from_the_logs() -> None:
    local = Script(fail(RuntimeError("down")))
    planner = Script(final(**JUDGMENT))
    leaked = "DATABASE_URL=postgres://app:hunter2@db:5432/app"
    with client_with(("local", local.model), ("planner", RedactingModel(planner.model))) as c:
        post(c, body(logs=[leaked, "Error: boom"]))
    assert "hunter2" not in planner.sent()
    assert "boom" in planner.sent()


def test_needs_the_bearer_token() -> None:
    local = Script()
    with client_with(("local", local.model)) as c:
        assert post(c, body(), headers={}).status_code == 401
        assert post(c, body(), headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert local.requests == []


@pytest.mark.parametrize(
    ("over", "path"),
    [
        ({"alertname": ""}, "alertname"),
        ({"logs": ["x"] * 201}, "logs"),
        ({"surprise": 1}, "surprise"),
    ],
)
def test_rejects_a_bad_request(over: dict[str, Any], path: str) -> None:
    with client_with(("local", Script().model)) as c:
        res = post(c, body(**over))
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_INCIDENT"
    assert res.json()["error"]["fields"][0]["path"] == path


def test_settings_order_is_local_then_redacted_planner(settings: Settings) -> None:
    assert [n for n, _ in judges_from_settings(settings).order] == ["local"]
    with_api = settings.model_copy(
        update={
            "planner_model_url": settings.local_model_url,
            "planner_model_name": "gpt",
        }
    )
    order = judges_from_settings(with_api).order
    assert [n for n, _ in order] == ["local", "planner"]
    assert isinstance(order[1][1], RedactingModel)
