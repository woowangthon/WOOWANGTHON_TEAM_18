import asyncio
import json
import logging
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import httpx2
import pytest
from fastapi.testclient import TestClient
from openai import AsyncOpenAI
from pydantic import ValidationError
from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from ai_server.agent.explain import (
    DeployExplanation,
    ExplainRequest,
    _clip,
    explain,
    explainer_from_settings,
)
from ai_server.agent.redact import RedactingModel
from ai_server.config import Settings
from ai_server.main import create_app
from tests.conftest import AUTH, classify_only
from tests.scripted import Script, fail, text

EXPLANATION: dict[str, Any] = {
    "summary": "my-app 배포가 끝나 B 슬롯으로 넘어갔습니다.",
    "steps": [
        {
            "stage": "build",
            "did": "이미지를 새로 만들었습니다.",
            "meaning": "코드를 실행 가능한 꾸러미로 묶습니다.",
        },
        {
            "stage": "switch",
            "did": "공개 주소를 B로 옮겼습니다.",
            "meaning": "사용자가 새 버전을 봅니다.",
        },
    ],
    "cause": None,
    "actions": [],
    "terms": [{"term": "슬롯", "meaning": "배포를 올려 두는 두 자리 중 하나입니다."}],
}


def service(**over: Any) -> dict[str, Any]:
    return {
        "name": "be",
        "role": "be",
        "kind": "server",
        "port": 3000,
        "ingressPath": "/api",
        "health": {"type": "http", "path": "/health"},
        "build": "run",
        "framework": "nestjs",
        "hasDockerfile": True,
        "buildCommand": None,
        "startCommand": "node dist/main.js",
        "envCount": 2,
        "secretCount": 1,
        **over,
    }


def ok_body(**over: Any) -> dict[str, Any]:
    return {
        "deployId": "dep-1",
        "outcome": "succeeded",
        "targetSlot": "b",
        "firstDeploy": False,
        "services": [service()],
        "failure": None,
        "evidence": None,
        "agent": None,
        **over,
    }


def failed_body(logs: list[str], **over: Any) -> dict[str, Any]:
    return ok_body(
        outcome="failed",
        failure={
            "code": "VERIFY_FAILED",
            "stage": "verify",
            "service": "be",
            "message": "새 슬롯이 건강 점검을 통과하지 못했습니다.",
        },
        evidence={
            "errorMessage": "health check timed out",
            "logs": logs,
            "pods": ["be-b-1 CrashLoopBackOff"],
            "events": ["Back-off restarting failed container"],
            "renderStatus": None,
        },
        **over,
    )


@contextmanager
def client_with(explainer: Model | None, effort: str = "medium") -> Iterator[TestClient]:
    settings = Settings(
        _env_file=None,
        agent_api_token="t" * 32,
        gateway_url="http://platform:4000/mcp",
        # 셸 env의 PLANNER_MODEL_*로 실제 모델이 만들어지지 않게 비운다(인자가 env보다 앞선다).
        planner_model_url=None,
        planner_model_name=None,
        planner_model_api_key=None,
        explain_reasoning_effort=effort,
    )
    with TestClient(create_app(settings, runner=classify_only, explainer=explainer)) as c:
        yield c


def post(c: TestClient, payload: Any, headers: dict[str, str] = AUTH) -> Any:
    return c.post("/agent/explanations", json=payload, headers=headers)


def test_success_returns_the_explanation_and_the_prompt_has_the_service() -> None:
    script = Script(text(**EXPLANATION))
    with client_with(script.model) as c:
        res = post(c, ok_body())
    assert res.status_code == 200
    assert res.json() == EXPLANATION
    sent = script.sent()
    assert '"port": 3000' in sent
    assert '"ingressPath": "/api"' in sent
    assert '"build": "run"' in sent
    assert '"targetSlot": "b"' in sent
    # 도구 없이, native output으로 부른다.
    assert script.infos[0].function_tools == []
    assert script.infos[0].output_tools == []


def test_prompt_keys_are_camel_case() -> None:
    script = Script(text(**EXPLANATION))
    with client_with(script.model) as c:
        post(c, failed_body(["Error: boom"]))
    sent = script.sent()
    for key in ("ingressPath", "targetSlot", "firstDeploy", "errorMessage", "renderStatus"):
        assert f'"{key}"' in sent
    for snake in ("ingress_path", "target_slot", "first_deploy", "error_message", "render_status"):
        assert snake not in sent


def test_failed_logs_reach_the_model_but_a_secret_does_not() -> None:
    script = Script(text(**EXPLANATION))
    leaked = "DATABASE_URL=postgres://app:hunter2@db/app"
    logs = [leaked, "listening on 3000", "Error: connect ECONNREFUSED db:5432"]
    with client_with(RedactingModel(script.model)) as c:
        assert post(c, failed_body(logs)).status_code == 200
    sent = script.sent()
    assert "hunter2" not in sent
    assert "ECONNREFUSED" in sent
    assert "health check timed out" in sent
    assert "CrashLoopBackOff" in sent


def test_long_logs_are_excerpted() -> None:
    script = Script(text(**EXPLANATION))
    logs = [f"line {i}" for i in range(200)]
    with client_with(script.model) as c:
        assert post(c, failed_body(logs)).status_code == 200
    sent = script.sent()
    assert "line 199" in sent
    assert 'line 0"' not in sent


def test_a_secret_in_the_model_output_is_masked() -> None:
    token = "ghp_" + "a1B2" * 9
    out = {
        **EXPLANATION,
        "summary": f"토큰 {token} 이 보입니다.",
        "actions": ["키 sk-" + "x" * 30 + " 를 바꾸세요."],
    }
    script = Script(text(**out))
    with client_with(script.model) as c:
        res = post(c, ok_body())
    assert res.status_code == 200
    assert token not in res.text
    assert "sk-xxxx" not in res.text
    assert "[REDACTED]" in res.json()["summary"]
    assert "[REDACTED]" in res.json()["actions"][0]


def test_over_long_output_is_clipped() -> None:
    step = {"stage": "build", "did": "d" * 500, "meaning": "m" * 500}
    out = {
        "summary": "s" * 500,
        "steps": [step] * 8,
        "cause": "c" * 500,
        "actions": ["a" * 500] * 7,
        "terms": [{"term": "t" * 100, "meaning": "x" * 500}] * 7,
    }
    script = Script(text(**out))
    with client_with(script.model) as c:
        res = post(c, failed_body(["Error"]))
    body = res.json()
    assert len(body["summary"]) == 300
    assert len(body["steps"]) == 6
    assert all(len(s["did"]) == 300 and len(s["meaning"]) == 300 for s in body["steps"])
    assert len(body["cause"]) == 300
    assert len(body["actions"]) == 5
    assert all(len(a) == 200 for a in body["actions"])
    assert len(body["terms"]) == 5
    assert all(len(t["term"]) == 40 and len(t["meaning"]) == 200 for t in body["terms"])
    assert body["summary"].endswith("…")


def test_a_secret_on_the_length_limit_is_masked_whole() -> None:
    token = "ghp_" + "a1B2" * 9
    out = DeployExplanation.model_validate({**EXPLANATION, "summary": "s" * 290 + token})
    summary = _clip(out).summary
    assert "ghp_" not in summary
    assert summary == "s" * 290 + "[REDACTED]"


def test_clip_keeps_short_text_and_a_null_cause() -> None:
    out = DeployExplanation.model_validate(EXPLANATION)
    assert _clip(out) == out


def test_503_when_there_is_no_explainer() -> None:
    with client_with(None) as c:
        res = post(c, ok_body())
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "MODEL_UNAVAILABLE"


def test_503_when_the_model_fails_and_the_log_has_no_message(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    script = Script(fail(RuntimeError("token=sk-SECRETSECRETSECRET1234")))
    with client_with(script.model) as c:
        res = post(c, ok_body())
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "MODEL_UNAVAILABLE"
    assert "SECRETSECRET" not in caplog.text
    assert "RuntimeError" in caplog.text


def test_503_when_the_model_answers_a_bad_shape() -> None:
    bad = {**EXPLANATION, "surprise": 1}
    script = Script(text(**bad), text(**bad), text(**bad))
    with client_with(script.model) as c:
        res = post(c, ok_body())
    assert res.status_code == 503


def test_needs_the_bearer_token() -> None:
    script = Script()
    with client_with(script.model) as c:
        assert post(c, ok_body(), headers={}).status_code == 401
        res = post(c, ok_body(), headers={"Authorization": "Bearer wrong"})
        assert res.status_code == 401
        assert res.json()["error"]["code"] == "AUTH_REQUIRED"
    assert script.requests == []


@pytest.mark.parametrize(
    ("over", "path"),
    [
        ({"surprise": 1}, "surprise"),
        ({"failure": failed_body([])["failure"]}, ""),
        ({"outcome": "failed"}, ""),
        ({"evidence": failed_body(["x"] * 201)["evidence"]}, "evidence.logs"),
        ({"services": []}, "services"),
        (
            {
                "outcome": "failed",
                "failure": {**failed_body([])["failure"], "stage": "deploy"},
            },
            "failure.stage",
        ),
    ],
)
def test_rejects_a_bad_request(over: dict[str, Any], path: str) -> None:
    script = Script()
    with client_with(script.model) as c:
        res = post(c, ok_body(**over))
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_EXPLANATION"
    assert res.json()["error"]["fields"][0]["path"] == path
    assert script.requests == []


def test_request_model_forbids_extra_keys_and_accepts_camel_case() -> None:
    assert ExplainRequest.model_validate(ok_body()).target_slot == "b"
    with pytest.raises(ValidationError):
        ExplainRequest.model_validate(ok_body(extra=1))


def test_wire_request_to_an_openai_chat_model() -> None:
    captured: list[dict[str, Any]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        captured.append(json.loads(request.content))
        return httpx2.Response(
            200,
            json={
                "id": "c-1",
                "object": "chat.completion",
                "created": 0,
                "model": "reasoner",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {"role": "assistant", "content": json.dumps(EXPLANATION)},
                    }
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            },
        )

    client = AsyncOpenAI(
        api_key="unused",
        base_url="http://gateway.invalid/v1",
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)),
    )
    model = RedactingModel(
        OpenAIChatModel("reasoner", provider=OpenAIProvider(openai_client=client))
    )
    out = asyncio.run(explain(ExplainRequest.model_validate(ok_body()), model, "high"))
    assert out is not None
    assert out.summary == EXPLANATION["summary"]
    assert len(captured) == 1
    sent = captured[0]
    assert "tools" not in sent
    assert "tool_choice" not in sent
    assert sent["reasoning_effort"] == "high"
    fmt = sent["response_format"]
    assert fmt["type"] == "json_schema"
    schema = fmt["json_schema"]
    assert schema["strict"] is True
    root = schema["schema"]
    assert root["additionalProperties"] is False
    assert root["required"] == ["summary", "steps", "cause", "actions", "terms"]

    objects: list[dict[str, Any]] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "object":
                objects.append(node)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(root)
    assert len(objects) >= 3
    for obj in objects:
        assert obj["additionalProperties"] is False
        assert sorted(obj["required"]) == sorted(obj["properties"])


def test_explainer_from_settings(settings: Settings) -> None:
    assert explainer_from_settings(settings) is None
    with_api = settings.model_copy(
        update={"planner_model_url": settings.local_model_url, "planner_model_name": "gpt"}
    )
    assert isinstance(explainer_from_settings(with_api), RedactingModel)


def test_effort_setting_reaches_the_model() -> None:
    script = Script(text(**EXPLANATION))
    with client_with(script.model, effort="low") as c:
        post(c, ok_body())
    assert script.infos[0].model_settings is not None
    assert script.infos[0].model_settings.get("openai_reasoning_effort") == "low"
