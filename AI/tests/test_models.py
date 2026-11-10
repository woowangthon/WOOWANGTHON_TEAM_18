from typing import Any

import pytest
from pydantic import ValidationError

from ai_server.agent.models import AgentResult, CloseNotice, Ticket, TicketRequest
from tests.samples import SHA, result, ticket, ticket_request


def test_ticket_sample_parses_and_dumps_back_in_camel_case() -> None:
    t = Ticket.model_validate(ticket())
    assert (t.ticket_id, t.stage, t.target_slot) == ("t_0013", "apply", "b")
    dumped = t.model_dump(mode="json", by_alias=True)
    assert dumped["logs"]["from"] == "2026-11-10T13:02:00Z"
    assert dumped["raw"]["k8s"] == {"pod": {}, "events": [], "status": None}


def test_ticket_raw_is_kept_as_is() -> None:
    pod = {"status": {"containerStatuses": [{"state": {"waiting": {"reason": "X"}}}]}}
    t = Ticket.model_validate(
        ticket(raw={"codebuild": None, "k8s": {"pod": pod, "events": [{"a": 1}], "status": None}})
    )
    assert t.raw.k8s is not None and t.raw.k8s.pod == pod
    b = Ticket.model_validate(ticket(stage="build", raw={"codebuild": {"any": [1]}, "k8s": None}))
    assert b.raw.codebuild == {"any": [1]} and b.raw.k8s is None


@pytest.mark.parametrize(
    "key",
    [
        "ticketId",
        "commitSha",
        "stage",
        "service",
        "targetSlot",
        "deployInput",
        "errorMessage",
        "raw",
        "logs",
        "previous",
    ],
)
def test_every_ticket_key_is_required(key: str) -> None:
    t = ticket()
    del t[key]
    with pytest.raises(ValidationError) as e:
        Ticket.model_validate(t)
    assert e.value.errors()[0]["type"] == "missing"


@pytest.mark.parametrize(
    "overrides",
    [
        {"commitSha": SHA[:39]},
        {"commitSha": SHA + "0"},
        {"commitSha": " " + SHA},
        {"commitSha": SHA.upper()},
        {"stage": "verify"},
        {"targetSlot": "c"},
        {"ticketId": ""},
        {"service": ""},
        {"unknown": 1},
        {"logs": {"from": "2026-11-10T13:02:00", "to": "2026-11-10T13:12:00Z", "lines": []}},
        {
            "logs": {
                "from": "2026-11-10T13:02:00Z",
                "to": "2026-11-10T13:12:00Z",
                "lines": ["x"] * 201,
            }
        },
        {"previous": {"ticketId": "t_1", "status": "needs_user"}},
        {"previous": {"ticketId": "t_1", "status": "running", "summary": ""}},
        {"raw": {"codebuild": None, "k8s": {"pod": {}, "events": []}}},
    ],
)
def test_ticket_rejects(overrides: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        Ticket.model_validate(ticket(**overrides))


def test_ticket_accepts_null_service_and_previous_and_200_lines() -> None:
    logs = {"from": "2026-11-10T13:02:00Z", "to": "2026-11-10T13:12:00Z", "lines": ["x"] * 200}
    prev = {"ticketId": "t_0012", "status": "needs_user", "summary": "DATABASE_URL 재입력 요청"}
    t = Ticket.model_validate(ticket(service=None, logs=logs, previous=prev))
    assert t.service is None
    assert t.previous is not None and t.previous.summary == "DATABASE_URL 재입력 요청"


@pytest.mark.parametrize(
    "status", ["verified", "pr_opened", "needs_user", "gave_up", "stopped"]
)
def test_previous_status_values(status: str) -> None:
    prev = {"ticketId": "t_0012", "status": status, "summary": ""}
    assert Ticket.model_validate(ticket(previous=prev)).previous is not None


K8S = {"pod": None, "events": [], "status": None}
STATUS = {"kind": "Status", "code": 422}


@pytest.mark.parametrize(
    ("stage", "raw", "problems"),
    [
        ("build", {"codebuild": None, "k8s": None}, [("raw.codebuild", "REQUIRED")]),
        ("build", {"codebuild": {}, "k8s": K8S}, [("raw.k8s", "MUST_BE_NULL")]),
        ("apply", {"codebuild": {}, "k8s": K8S}, [("raw.codebuild", "MUST_BE_NULL")]),
        ("prepare", {"codebuild": None, "k8s": None}, [("raw.k8s", "REQUIRED")]),
        ("render", {"codebuild": None, "k8s": K8S}, [("raw.k8s.status", "REQUIRED")]),
        ("apply", {"codebuild": None, "k8s": {**K8S, "status": STATUS}}, [("raw.k8s.status", "MUST_BE_NULL")]),
        ("prepare", {"codebuild": {}, "k8s": None}, [("raw.codebuild", "MUST_BE_NULL"), ("raw.k8s", "REQUIRED")]),
    ],
)
def test_raw_must_fit_the_stage(stage: str, raw: dict[str, Any], problems: list[tuple[str, str]]) -> None:
    with pytest.raises(ValidationError) as e:
        Ticket.model_validate(ticket(stage=stage, raw=raw))
    [err] = e.value.errors()
    assert err["type"] == "raw_shape"
    assert err["ctx"]["fields"] == problems


@pytest.mark.parametrize(
    ("stage", "raw"),
    [
        ("build", {"codebuild": {}, "k8s": None}),
        ("prepare", {"codebuild": None, "k8s": K8S}),
        ("render", {"codebuild": None, "k8s": {**K8S, "status": STATUS}}),
        ("apply", {"codebuild": None, "k8s": K8S}),
    ],
)
def test_raw_shapes_that_fit(stage: str, raw: dict[str, Any]) -> None:
    assert Ticket.model_validate(ticket(stage=stage, raw=raw)).stage == stage


def test_ticket_request_needs_gateway_token() -> None:
    body = ticket_request()
    body["gateway"]["token"] = ""
    with pytest.raises(ValidationError):
        TicketRequest.model_validate(body)


def test_close_notice() -> None:
    n = CloseNotice.model_validate({"ticketId": "t_1", "commitSha": SHA, "reason": "success"})
    assert n.reason == "success"
    with pytest.raises(ValidationError):
        CloseNotice.model_validate({"ticketId": "t_1", "commitSha": SHA, "reason": "done"})


# ---- 해결 결과 (§6) ----


def test_result_minimal_gave_up() -> None:
    r = AgentResult.model_validate(result())
    assert r.status == "gave_up"
    assert r.model_dump(by_alias=True, exclude_none=True)["classification"]["caseId"] == "A1"


@pytest.mark.parametrize(
    ("status", "field", "value"),
    [
        ("verified", "specPatch", []),
        (
            "pr_opened",
            "pr",
            {"url": "https://github.com/o/r/pull/1", "files": ["a"], "changedLines": 3},
        ),
        (
            "needs_user",
            "userRequest",
            {"message": "DATABASE_URL을 다시 넣어 주세요", "secretKeys": ["DATABASE_URL"]},
        ),
    ],
)
def test_status_requires_its_field(status: str, field: str, value: Any) -> None:
    with pytest.raises(ValidationError, match=f"requires {field}"):
        AgentResult.model_validate(result(status=status))
    assert AgentResult.model_validate(result(status=status, **{field: value})).status == status


@pytest.mark.parametrize(
    "path",
    [
        "/spec/services/0/build/nodeVersion",
        "/spec/services/12/runtime/resources/memory",
        "/spec/services/1/name",
        "/spec/project/slug",
    ],
)
def test_spec_patch_allowed_paths(path: str) -> None:
    patch = [{"op": "replace", "path": path, "value": "x"}]
    assert AgentResult.model_validate(result(status="verified", specPatch=patch)).spec_patch


@pytest.mark.parametrize(
    "path",
    [
        "/spec/services/0/build",  # build 자체를 통째로 바꾸지 않는다
        "/spec/services/0/role",
        "/spec/services/x/runtime/port",
        "/spec/services/0/name/x",
        "/spec/project/repo",
        "/spec/project/slugs",
        "/deploy_condition/x",
        "spec/services/0/runtime/port",
    ],
)
def test_spec_patch_forbidden_paths(path: str) -> None:
    patch = [{"op": "replace", "path": path, "value": "x"}]
    with pytest.raises(ValidationError):
        AgentResult.model_validate(result(status="verified", specPatch=patch))


@pytest.mark.parametrize(
    "overrides",
    [
        {"specPatch": [{"op": "move", "path": "/spec/project/slug"}]},
        {"buildOverrides": {"timeoutMinutes": 31}},
        {"pr": {"files": ["a", "b", "c", "d", "e", "f"]}},
        {"pr": {"changedLines": 51}},
        {"commitSha": "abc"},
        {"status": "solved"},
        {"classification": {"method": "guess", "caseId": None, "path": "plan"}},
        {"classification": {"method": "llm", "caseId": None, "path": "retry"}},
        {"summary": ""},
        {"extra": True},
    ],
)
def test_result_rejects(overrides: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        AgentResult.model_validate(result(**overrides))


def test_result_limits_at_the_edge() -> None:
    r = AgentResult.model_validate(
        result(
            buildOverrides={"timeoutMinutes": 30, "cache": True},
            pr={"files": ["a", "b", "c", "d", "e"], "changedLines": 50},
        )
    )
    assert r.build_overrides is not None and r.build_overrides.timeout_minutes == 30
    assert r.pr is not None and r.pr.changed_lines == 50
