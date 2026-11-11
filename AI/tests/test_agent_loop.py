"""에이전트 흐름 ① ~ ⑤를 대역 모델(FunctionModel)과 대역 게이트웨이로 시험한다."""

import asyncio
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ToolReturnPart

from ai_server.agent import loop
from ai_server.agent.gateway import connect_gateway
from ai_server.agent.loop import Models, make_agent_runner, make_models, models_from_settings
from ai_server.agent.memory import CaseMemory, load_cases
from ai_server.agent.models import GatewayGrant, Ticket
from ai_server.agent.prompts import INSTRUCTIONS
from ai_server.agent.runs import TicketRun
from ai_server.config import Settings
from ai_server.main import create_app
from tests.conftest import AUTH
from tests.fake_gateway import FakeGateway, reject
from tests.samples import SHA, ticket, ticket_request
from tests.scripted import Script, call, fail, final
from tests.test_memory import SIGNALS
from tests.test_tickets_api import wait_until

PORT_PATCH = [{"op": "replace", "path": "/spec/services/0/runtime/port", "value": 3000}]


def make_run(**overrides: Any) -> TicketRun:
    return TicketRun(
        ticket=Ticket.model_validate(ticket(**overrides)),
        gateway=GatewayGrant.model_validate(
            {"token": "gw_tok", "expiresAt": "2026-11-10T13:27:00Z"}
        ),
    )


def solve(
    run: TicketRun,
    gateway: FakeGateway,
    local: Script,
    planner: Script | None = None,
    models: Models | None = None,
    memory: CaseMemory | None = None,
) -> CaseMemory:
    memory = memory or CaseMemory(load_cases())
    if models is None:
        models = Models(local=local.model, planner=(planner or Script()).model)
    tokens: list[str] = []

    def gateway_for(token: str) -> Any:
        tokens.append(token)
        return gateway.toolset()

    asyncio.run(make_agent_runner(models, gateway_for)(run, memory))
    assert tokens == ["gw_tok"]
    return memory


def only_result(gateway: FakeGateway) -> dict[str, Any]:
    [result] = gateway.submitted
    return result


# ---- ③ playbook ----


def test_code_case_runs_its_playbook_and_submits_once() -> None:
    gw = FakeGateway()
    local = Script(
        call("read_pod_logs", service="be", lines=100),
        call("run_render", specPatch=PORT_PATCH),
        call("run_deploy", specPatch=PORT_PATCH),
        call("run_verify"),
        final(
            status="verified",
            specPatch=PORT_PATCH,
            summary="앱이 3000번 포트로 떠 있어 runtime.port를 3000으로 고쳤습니다.",
            evidence=[{"ref": "read_pod_logs", "text": "Server listening on port 3000"}],
        ),
    )
    planner = Script()
    run = make_run(**SIGNALS["A1"])
    memory = solve(run, gw, local, planner)

    assert gw.tool_calls() == ["read_pod_logs", "run_render", "run_deploy", "run_verify"]
    result = only_result(gw)
    assert result["ticketId"] == "t_0013" and result["commitSha"] == SHA
    assert result["status"] == "verified" and result["specPatch"] == PORT_PATCH
    assert result["classification"] == {"method": "code", "caseId": "A1", "path": "playbook"}
    # 기록은 모델이 말한 것이 아니라 게이트웨이에 실제로 한 호출이다.
    assert [(a["tool"], a["ok"]) for a in result["actions"]] == [
        ("read_pod_logs", True),
        ("run_render", True),
        ("run_deploy", True),
        ("run_verify", True),
    ]
    assert result["actions"][1]["args"] == {"specPatch": PORT_PATCH}
    assert result["evidence"][0]["ref"] == "read_pod_logs"
    assert run.case_id == "A1"
    a1 = memory.get("A1")
    assert a1 is not None and a1.stats.hits == 1
    # playbook은 로컬 모델이 돌고, 추론 모델은 부르지 않는다.
    assert local.done and planner.requests == []
    first = local.sent(0)
    assert INSTRUCTIONS in first and '"caseId":"A1"' in first and "Ticket t_0013" in first


def test_model_gets_gateway_tools_and_read_memory_but_not_submit_result() -> None:
    gw = FakeGateway()
    local = Script(final(status="gave_up", summary="모름"))
    planner = Script(final(status="gave_up", summary="모름"))
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    names = {t.name for t in local.infos[0].function_tools}
    assert "submit_result" not in names
    assert {
        "read_memory",
        "run_build",
        "run_render",
        "run_deploy",
        "run_verify",
        "open_pr",
    } <= names


def test_read_memory_is_answered_inside_the_ai_server() -> None:
    gw = FakeGateway()
    local = Script(
        call("read_memory", stage="apply"),
        final(
            status="needs_user", userRequest={"message": "DB 주소를 확인해 주세요"}, summary="DB"
        ),
    )
    solve(make_run(**SIGNALS["A2"]), gw, local)
    [answer] = [
        p.content
        for p in local.requests[1][-1].parts
        if isinstance(p, ToolReturnPart) and p.tool_name == "read_memory"
    ]
    # 도구 결과의 타입은 PydanticAI가 여러 모양의 합으로 두므로, 우리 도구가 돌려준 모양으로 읽는다.
    cases = cast(dict[str, Any], answer)["cases"]
    ids = [c["caseId"] for c in cases]
    assert ids == ["A3", "A4", "A1", "A2"]
    assert gw.tool_calls() == []
    assert only_result(gw)["actions"] == []


# ---- ② LLM 분류 ----


def test_unmatched_ticket_is_classified_by_the_local_model() -> None:
    gw = FakeGateway()
    local = Script(
        final(case_id="A1"),
        final(
            status="needs_user",
            userRequest={"message": "헬스체크 경로를 알려 주세요"},
            summary="경로를 모름",
        ),
    )
    run = make_run()  # 어느 case의 신호도 없는 apply 티켓
    memory = solve(run, gw, local)
    result = only_result(gw)
    assert result["classification"] == {"method": "llm", "caseId": "A1", "path": "playbook"}
    assert result["userRequest"] == {"message": "헬스체크 경로를 알려 주세요", "secretKeys": []}
    a1 = memory.get("A1")
    assert a1 is not None and a1.stats.hits == 1 and run.case_id == "A1"
    # 분류에는 그 단계의 case만 보여 주고 도구는 주지 않는다.
    listing = local.sent(0)
    assert '"A1"' in listing and '"A4"' in listing and '"B1"' not in listing
    assert local.infos[0].function_tools == []


@pytest.mark.parametrize("answer", [None, "Z9", "B1"])  # B1은 다른 단계의 case
def test_unknown_case_goes_to_planning(answer: str | None) -> None:
    gw = FakeGateway()
    local = Script(final(case_id=answer))
    planner = Script(
        call("get_target_status"), final(status="gave_up", summary="원인을 찾지 못했습니다.")
    )
    run = make_run()
    memory = solve(run, gw, local, planner)
    result = only_result(gw)
    assert result["classification"] == {"method": "llm", "caseId": None, "path": "plan"}
    assert gw.tool_calls() == ["get_target_status"]
    assert planner.done and "No known case matches" in planner.sent(0)
    assert run.case_id is None
    assert all(c.stats.hits == 0 for c in memory.cases)


# ---- ④ 실패 기반 재계획 ----


def test_failed_playbook_is_replanned_by_the_planner() -> None:
    gw = FakeGateway()
    gw.script["run_deploy"] = [{"ok": False, "services": [], "pods": [], "events": []}]
    local = Script(
        call("run_deploy", specPatch=PORT_PATCH),
        final(status="gave_up", summary="포트를 바꿔도 Ready가 되지 않음"),
    )
    patch = [{"op": "replace", "path": "/spec/services/0/runtime/health/path", "value": "/healthz"}]
    planner = Script(
        call("run_deploy", specPatch=patch),
        call("run_verify"),
        final(status="verified", specPatch=patch, summary="헬스체크 경로를 /healthz로 고쳤습니다."),
    )
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    result = only_result(gw)
    assert result["classification"] == {
        "method": "code",
        "caseId": "A1",
        "path": "replan_after_playbook",
    }
    assert result["status"] == "verified" and result["specPatch"] == patch
    assert [(a["tool"], a["ok"]) for a in result["actions"]] == [
        ("run_deploy", False),
        ("run_deploy", True),
        ("run_verify", True),
    ]
    replan = planner.sent(0)
    assert "포트를 바꿔도 Ready가 되지 않음" in replan and "- run_deploy ok=False" in replan


@pytest.mark.parametrize("status", ["verified", "needs_user"])
def test_playbook_that_did_not_give_up_is_not_replanned(status: str) -> None:
    gw = FakeGateway()
    extra: dict[str, Any] = (
        {"specPatch": []} if status == "verified" else {"userRequest": {"message": "x"}}
    )
    local = Script(final(status=status, summary="끝", **extra))
    planner = Script()
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    assert only_result(gw)["classification"]["path"] == "playbook"
    assert planner.requests == []


# ---- 게이트웨이 거절 ----


@pytest.mark.parametrize(
    ("code", "words"),
    [
        ("TOOL_LIMIT", "도구 호출 횟수 한도"),
        ("TIME_LIMIT", "작업 시간 한도"),
        ("LIVE_SLOT_PROTECTED", "플랫폼 문제"),
    ],
)
def test_stop_codes_end_the_run_with_gave_up_and_a_reason(code: str, words: str) -> None:
    gw = FakeGateway()
    gw.script["run_render"] = [reject(code, "no more")]
    local = Script(call("run_render", specPatch=PORT_PATCH))
    planner = Script()
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    result = only_result(gw)
    assert result["status"] == "gave_up" and words in result["summary"]
    assert result["classification"] == {"method": "code", "caseId": "A1", "path": "playbook"}
    assert result["actions"] == [
        {
            "tool": "run_render",
            "args": {"specPatch": PORT_PATCH},
            "ok": False,
            "result": f"rejected {code}: no more",
        }
    ]
    # 멈추면 재계획하지 않는다.
    assert planner.requests == []


def test_closed_ticket_submits_nothing() -> None:
    gw = FakeGateway()
    gw.script["run_verify"] = [reject("TICKET_CLOSED")]
    local = Script(call("run_verify"))
    solve(make_run(**SIGNALS["A1"]), gw, local)
    assert gw.submitted == []


def test_other_rejections_go_back_to_the_model() -> None:
    gw = FakeGateway()
    gw.script["run_render"] = [
        reject("PATCH_FORBIDDEN", "path /spec/services/0/role is not allowed")
    ]
    bad = [{"op": "replace", "path": "/spec/services/0/role", "value": "fe"}]
    local = Script(
        call("run_render", specPatch=bad),
        call("run_render", specPatch=PORT_PATCH),
        final(status="verified", specPatch=PORT_PATCH, summary="포트를 고쳤습니다."),
    )
    solve(make_run(**SIGNALS["A1"]), gw, local)
    assert "PATCH_FORBIDDEN" in local.sent(1) and "is not allowed" in local.sent(1)
    actions = only_result(gw)["actions"]
    assert (actions[0]["ok"], actions[0]["result"][:24]) == (False, "rejected PATCH_FORBIDDEN")
    assert actions[1]["ok"] is True


def test_failed_run_is_ok_false_not_a_rejection() -> None:
    gw = FakeGateway()
    gw.script["run_verify"] = [
        {
            "ok": False,
            "ready": [],
            "requests": [{"service": "be", "path": "/", "status": 502, "ms": 5, "error": None}],
        }
    ]
    local = Script(call("run_verify"), final(status="gave_up", summary="502"))
    planner = Script(final(status="gave_up", summary="502가 계속 납니다."))
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    [action] = only_result(gw)["actions"]
    assert action["ok"] is False and '"status": 502' in action["result"]


# ---- 출력 모양 ----


def test_result_of_the_wrong_shape_is_made_again() -> None:
    gw = FakeGateway()
    local = Script(
        final(status="verified", summary="고쳤습니다."),  # specPatch가 없다
        final(status="verified", specPatch=[], summary="그대로 다시 실행해 통과했습니다."),
    )
    solve(make_run(**SIGNALS["A1"]), gw, local)
    assert "requires specPatch" in local.sent(1)
    assert only_result(gw)["specPatch"] == []


def test_model_that_never_answers_right_is_reported_as_gave_up() -> None:
    gw = FakeGateway()
    local = Script(*[final(status="verified", summary="x") for _ in range(3)])
    solve(make_run(**SIGNALS["A1"]), gw, local)
    result = only_result(gw)
    assert result["status"] == "gave_up" and "AI 모델 호출이 실패" in result["summary"]
    assert result["classification"]["path"] == "playbook"


# ---- 추론 모델 API: 가림 필터 (FR-102)와 로컬로 넘기기 ----

SECRET_LOG = "connect failed: postgres://app:hunter2pass@db:5432/app DATABASE_PASSWORD=s3cr3tvalue"


def test_planner_api_gets_redacted_text_and_local_model_does_not_need_it() -> None:
    gw = FakeGateway()
    gw.script["read_pod_logs"] = [{"lines": ["Authorization: Bearer abcdefghijklmnop1234"]}]
    local = Script(final(case_id=None))
    api = Script(
        call("read_pod_logs", service="be"),
        final(status="gave_up", summary="DB에 닿지 않습니다."),
    )
    logs = {"from": "2026-11-10T13:02:00Z", "to": "2026-11-10T13:12:00Z", "lines": [SECRET_LOG]}
    run = make_run(logs=logs)
    solve(run, gw, local, models=make_models(local.model, api.model))
    for i in range(2):
        sent = api.sent(i)
        for secret in ("hunter2pass", "s3cr3tvalue", "abcdefghijklmnop1234", "gw_tok"):
            assert secret not in sent
    assert "[REDACTED]" in api.sent(0) and "postgres://app:[REDACTED]@db" in api.sent(0)
    assert "Bearer [REDACTED]" in api.sent(1)
    # 로컬 모델은 클러스터 안이라 가리지 않는다.
    assert "hunter2pass" in local.sent(0)
    # 가림은 모델로 가는 글에만 한다. 게이트웨이에 낸 결과의 기록은 원본이다.
    assert only_result(gw)["actions"][0]["result"].count("abcdefghijklmnop1234") == 1


def test_planner_api_failure_falls_back_to_the_local_model() -> None:
    gw = FakeGateway()
    local = Script(
        final(case_id=None), final(status="gave_up", summary="로컬 모델로 계획했습니다.")
    )
    api = Script(fail(ModelHTTPError(503, "reasoner")))
    solve(make_run(), gw, local, models=make_models(local.model, api.model))
    assert len(api.requests) == 1 and local.done
    assert only_result(gw)["summary"] == "로컬 모델로 계획했습니다."


def test_without_a_planner_api_the_local_model_plans() -> None:
    gw = FakeGateway()
    local = Script(final(case_id=None), final(status="gave_up", summary="로컬"))
    solve(make_run(), gw, local, models=make_models(local.model, None))
    assert local.done and only_result(gw)["classification"]["path"] == "plan"


# ---- 접수 API에서 끝까지 ----


def test_ticket_posted_to_the_api_ends_in_submit_result(settings: Settings) -> None:
    gw = FakeGateway()
    local = Script(call("run_verify"), final(status="verified", specPatch=[], summary="통과"))
    tokens: list[str] = []

    def gateway_for(token: str) -> Any:
        tokens.append(token)
        return gw.toolset()

    runner = make_agent_runner(Models(local=local.model, planner=Script().model), gateway_for)
    with TestClient(create_app(settings, runner=runner)) as c:
        res = c.post("/agent/tickets", json=ticket_request(**SIGNALS["A1"]), headers=AUTH)
        assert res.status_code == 202
        wait_until(lambda: len(gw.submitted) == 1)
        assert tokens == ["gw_abc"]
        assert (
            c.post(
                "/agent/tickets/t_0013/close",
                json={"ticketId": "t_0013", "commitSha": SHA, "reason": "success"},
                headers=AUTH,
            ).status_code
            == 204
        )
        a1 = c.app.state.runs.memory.get("A1")  # type: ignore[attr-defined]
        assert (a1.stats.hits, a1.stats.solved) == (1, 1)


# ---- 게이트웨이 장애 · 결과 제출 (#110 리뷰) ----


@pytest.fixture
def no_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(loop, "SUBMIT_RETRY_DELAYS", (0.0, 0.0, 0.0))


def test_unreachable_gateway_loses_the_result_but_says_so_in_the_log(
    no_wait: None, caplog: pytest.LogCaptureFixture
) -> None:
    local = Script()
    memory = CaseMemory(load_cases())
    run = make_run(**SIGNALS["A1"])
    runner = make_agent_runner(
        Models(local=local.model, planner=local.model),
        lambda token: connect_gateway("http://127.0.0.1:9/mcp", token),
    )
    asyncio.run(runner(run, memory))
    assert local.requests == []
    assert caplog.text.count("submit attempt") == 4
    assert "ticket t_0013 result not delivered: gateway unreachable" in caplog.text


def test_transport_error_during_a_tool_call_is_a_gave_up_with_the_reason(no_wait: None) -> None:
    gw = FakeGateway()
    gw.broken["run_render"] = 1
    local = Script(call("run_render", specPatch=PORT_PATCH))
    planner = Script()
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    result = only_result(gw)
    assert result["status"] == "gave_up"
    assert result["summary"].startswith("플랫폼 게이트웨이에 닿지 못해 멈췄습니다")
    assert gw.lost == ["run_render"] and planner.requests == []


def test_submit_is_retried_after_transport_errors(no_wait: None) -> None:
    gw = FakeGateway()
    gw.broken["submit_result"] = 2
    local = Script(final(status="verified", specPatch=PORT_PATCH, summary="포트를 고쳤습니다."))
    solve(make_run(**SIGNALS["A1"]), gw, local)
    assert gw.lost == ["submit_result", "submit_result"]
    result = only_result(gw)
    assert result["status"] == "verified" and result["specPatch"] == PORT_PATCH


def test_submit_gives_up_after_the_retries(no_wait: None, caplog: pytest.LogCaptureFixture) -> None:
    gw = FakeGateway()
    gw.broken["submit_result"] = 9
    local = Script(final(status="verified", specPatch=[], summary="통과"))
    solve(make_run(**SIGNALS["A1"]), gw, local)
    assert gw.lost == ["submit_result"] * 4 and gw.submitted == []
    assert "result not delivered: gateway unreachable" in caplog.text


def test_invalid_result_is_replaced_by_a_minimal_gave_up_once() -> None:
    gw = FakeGateway()
    gw.script["submit_result"] = [reject("INVALID_RESULT", "specPatch[0].path")]
    local = Script(
        call("run_verify"),
        final(
            status="verified",
            specPatch=PORT_PATCH,
            summary="고쳤습니다.",
            evidence=[{"ref": "a", "text": "b"}],
        ),
    )
    solve(make_run(**SIGNALS["A1"]), gw, local)
    first, second = gw.submitted
    assert first["status"] == "verified"
    assert second["status"] == "gave_up" and "플랫폼 검사에서 거절" in second["summary"]
    assert "specPatch" not in second and second["evidence"] == []
    assert second["classification"] == first["classification"]
    assert second["actions"] == first["actions"] and second["ticketId"] == "t_0013"


@pytest.mark.parametrize("code", ["INVALID_RESULT", "TICKET_CLOSED"])
def test_second_rejection_of_the_result_is_only_logged(
    code: str, caplog: pytest.LogCaptureFixture
) -> None:
    gw = FakeGateway()
    gw.script["submit_result"] = [reject(code)] * 3
    local = Script(final(status="gave_up", summary="모름"))
    planner = Script(final(status="gave_up", summary="모름"))
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    assert len(gw.submitted) == (2 if code == "INVALID_RESULT" else 1)
    assert f"result not delivered: submit_result rejected {code}" in caplog.text


def test_repeated_rejections_are_not_called_a_model_failure() -> None:
    gw = FakeGateway()
    gw.script["run_render"] = [reject("PATCH_FORBIDDEN", "role is not allowed")] * 4
    bad = [{"op": "replace", "path": "/spec/services/0/role", "value": "fe"}]
    local = Script(*[call("run_render", specPatch=bad) for _ in range(4)])
    solve(make_run(**SIGNALS["A1"]), gw, local)
    result = only_result(gw)
    assert result["status"] == "gave_up"
    assert result["summary"].startswith(
        "배포 설정 수정이 플랫폼 검사에서 계속 거절되어 멈췄습니다(마지막 거절: PATCH_FORBIDDEN)"
    )
    assert "AI 모델 호출이 실패" not in result["summary"]
    assert len(result["actions"]) == 4


def test_without_model_settings_each_ticket_gets_a_gave_up_that_says_so(
    settings: Settings,
) -> None:
    settings = settings.model_copy(update={"local_model_url": None, "local_model_name": None})
    assert models_from_settings(settings) is None
    gw = FakeGateway()
    run = make_run(**SIGNALS["A1"])
    asyncio.run(make_agent_runner(None, lambda token: gw.toolset())(run, CaseMemory(load_cases())))
    result = only_result(gw)
    assert result["status"] == "gave_up" and result["summary"].startswith("AI 모델 설정이 없어")
    assert result["classification"] == {"method": "code", "caseId": "A1", "path": "playbook"}
    assert gw.tool_calls() == [] and result["actions"] == []


# ---- W6 동작 확인 실패 (stage verify) ----


def test_verify_ticket_runs_the_v2_playbook() -> None:
    gw = FakeGateway()
    patch = [{"op": "replace", "path": "/spec/services/0/runtime/stripPrefix", "value": True}]
    local = Script(
        call("read_pod_logs", service="be", lines=100),
        call("run_deploy", specPatch=patch),
        call("run_verify"),
        final(
            status="verified",
            specPatch=patch,
            summary="앱이 /api 없이 받아 stripPrefix를 켰습니다.",
        ),
    )
    run = make_run(**SIGNALS["V2"])
    solve(run, gw, local)
    result = only_result(gw)
    assert result["classification"] == {"method": "code", "caseId": "V2", "path": "playbook"}
    assert result["specPatch"] == patch
    first = local.sent(0)
    assert '"caseId":"V2"' in first and "- be health GET /api/health: status 404" in first
