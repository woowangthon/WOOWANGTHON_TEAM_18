"""에이전트 흐름 ① ~ ⑤를 대역 모델(FunctionModel)과 대역 게이트웨이로 시험한다."""

import asyncio
import json
import re
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolReturnPart
from pydantic_ai.models.function import AgentInfo

from ai_server.agent import loop
from ai_server.agent.gateway import connect_gateway
from ai_server.agent.loop import Models, make_agent_runner, make_models, models_from_settings
from ai_server.agent.memory import CaseMemory, load_cases
from ai_server.agent.models import GatewayGrant, Ticket
from ai_server.agent.prompts import (
    EXECUTE_INSTRUCTIONS,
    GATEWAY_TOOLS,
    INSTRUCTIONS,
    PLAN_INSTRUCTIONS,
)
from ai_server.agent.runs import TicketRun
from ai_server.config import Settings
from ai_server.main import create_app
from tests.conftest import AUTH
from tests.fake_gateway import FakeGateway, reject
from tests.samples import SHA, ticket, ticket_request
from tests.scripted import Script, Step, call, fail, final, text_of
from tests.test_memory import SIGNALS
from tests.test_tickets_api import wait_until

READ_TOOLS = {"get_target_status", "read_pod_logs", "read_repo"}
PORT_PATCH = [{"op": "replace", "path": "/spec/services/0/runtime/port", "value": 3000}]
FINISH = {"tool": "submit_result", "when": "gave_up"}
# 추론 모델의 계획(AIagent.md §10). 단계를 주지 않으면 모든 게이트웨이 도구를 쓰는 계획이다.
ALL_STEPS: list[dict[str, Any]] = [
    {"tool": t} for t in sorted(GATEWAY_TOOLS - {"submit_result"})
] + [{"tool": "submit_result", "when": "결과로 끝낸다"}]


def plan(*steps: dict[str, Any], cause: str = "원인") -> Step:
    return final(cause=cause, steps=list(steps) or ALL_STEPS)


def classify(case_id: str | None) -> Step:
    return final(case_id=case_id)


def auto(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    """추론 모델 대역: 분류는 정규식 힌트대로, 계획은 모든 도구를 쓰는 계획, 그 밖에는 gave_up."""
    props = info.output_tools[0].parameters_json_schema.get("properties", {})
    if "case_id" in props:
        hint = re.search(r"Regex hint \(may be wrong\): ([A-Z][0-9]+)", text_of(messages))
        return classify(hint.group(1) if hint else None)(messages, info)
    if "steps" in props:
        return plan()(messages, info)
    return final(status="gave_up", summary="모름")(messages, info)


def planner_of(*steps: Step) -> Script:
    """앞의 분류 · 계획은 auto가 답하고, 그 뒤(재계획 · planning)는 steps가 답한다."""
    return Script(auto, auto, *steps) if steps else Script(*[auto] * 8)


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
        models = Models(local=local.model, planner=(planner or planner_of()).model)
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


# ---- ① 분류(추론 모델, 정규식은 힌트) → ② 계획(추론 모델) → ③ 실행(로컬 모델) ----

A1_STEPS: list[dict[str, Any]] = [
    {"tool": "run_render", "args": {"specPatch": PORT_PATCH}},
    {"tool": "run_deploy", "args": {"specPatch": PORT_PATCH}},
    {"tool": "run_verify"},
    {"tool": "submit_result", "when": "run_verify가 통과하면 verified"},
]
A1_RUN = (
    call("run_render", specPatch=PORT_PATCH),
    call("run_deploy", specPatch=PORT_PATCH),
    call("run_verify"),
)


def test_the_planner_classifies_and_plans_and_the_local_model_calls_the_tools() -> None:
    gw = FakeGateway()
    planner = Script(classify("A1"), plan(*A1_STEPS, cause="앱은 3000에서 듣는데 배포 설정은 8080"))
    local = Script(
        *A1_RUN,
        final(
            status="verified",
            specPatch=PORT_PATCH,
            summary="앱이 3000번 포트로 떠 있어 runtime.port를 3000으로 고쳤습니다.",
            evidence=[{"ref": "read_pod_logs", "text": "Server listening on port 3000"}],
        ),
    )
    run = make_run(**SIGNALS["A1"])
    memory = solve(run, gw, local, planner)

    assert gw.tool_calls() == ["run_render", "run_deploy", "run_verify"]
    result = only_result(gw)
    assert result["ticketId"] == "t_0013" and result["commitSha"] == SHA
    assert result["status"] == "verified" and result["specPatch"] == PORT_PATCH
    assert result["classification"] == {"method": "llm", "caseId": "A1", "path": "playbook"}
    # 기록은 모델이 말한 것이 아니라 게이트웨이에 실제로 한 호출이다.
    assert [(a["tool"], a["ok"]) for a in result["actions"]] == [
        ("run_render", True),
        ("run_deploy", True),
        ("run_verify", True),
    ]
    assert run.case_id == "A1"
    a1 = memory.get("A1")
    assert a1 is not None and a1.stats.hits == 1
    assert local.done and planner.done
    # 분류에는 정규식 힌트가 참고로 들어가고, 도구는 없다.
    assert "Regex hint (may be wrong): A1" in planner.sent(0)
    assert planner.infos[0].function_tools == []
    # 계획 단계에는 읽기 도구만 준다(바꾸는 도구 · 시험 도구는 로컬 모델이 계획대로 부른다).
    assert {t.name for t in planner.infos[1].function_tools} == READ_TOOLS
    plan_sent = planner.sent(1)
    assert PLAN_INSTRUCTIONS in plan_sent and '"caseId":"A1"' in plan_sent
    # 로컬 모델은 계획을 받고, 계획 지시문은 받지 않는다.
    executed = local.sent(0)
    assert EXECUTE_INSTRUCTIONS in executed and "Plan from the planner" in executed
    assert "You are the planner now" not in executed
    assert "앱은 3000에서 듣는데 배포 설정은 8080" in executed


def test_the_executor_gets_only_the_plans_tools() -> None:
    gw = FakeGateway()
    local = Script(*A1_RUN, final(status="verified", specPatch=PORT_PATCH, summary="고쳤습니다."))
    solve(make_run(**SIGNALS["A1"]), gw, local, Script(classify("A1"), plan(*A1_STEPS)))
    assert {t.name for t in local.infos[0].function_tools} == {
        "run_render",
        "run_deploy",
        "run_verify",
    }


def test_the_model_classification_wins_over_a_wrong_regex_hint() -> None:
    # 2026-11-14 실서비스 B5w: npm EBADENGINE 경고 + 실제 원인은 COPY 실패.
    gw = FakeGateway()
    lines = [
        "npm error code EBADENGINE",
        'ERROR: failed to solve: failed to compute cache key: "/dist": not found',
    ]
    build = {**SIGNALS["B5"], "logs": {**SIGNALS["B5"]["logs"], "lines": lines}}
    planner = Script(classify("B5"), plan(FINISH), final(status="gave_up", summary="모름"))
    local = Script(final(status="gave_up", summary="모름"))
    memory = solve(make_run(**build), gw, local, planner)
    assert "Regex hint (may be wrong): B5 — COPY 대상 없음; B2 — Node 버전 불일치" in planner.sent(
        0
    )
    assert only_result(gw)["classification"]["caseId"] == "B5"
    b2 = memory.get("B2")
    assert b2 is not None and b2.stats.hits == 0


def test_a_ticket_the_model_cannot_place_is_planned_by_the_planner_directly() -> None:
    gw = FakeGateway()
    planner = Script(
        classify(None),
        call("get_target_status"),
        final(status="gave_up", summary="원인을 찾지 못했습니다."),
    )
    run = make_run()  # 어느 case의 신호도 없는 apply 티켓
    memory = solve(run, gw, Script(), planner)
    result = only_result(gw)
    assert result["classification"] == {"method": "llm", "caseId": None, "path": "plan"}
    assert gw.tool_calls() == ["get_target_status"]
    assert "Regex hint: none" in planner.sent(0)
    assert "No known case matches" in planner.sent(1)
    assert run.case_id is None and all(c.stats.hits == 0 for c in memory.cases)


@pytest.mark.parametrize("answer", ["Z9", "B1"])  # B1은 다른 단계의 case
def test_a_case_id_not_in_the_list_is_unknown(answer: str) -> None:
    gw = FakeGateway()
    planner = Script(classify(answer), final(status="gave_up", summary="모름"))
    solve(make_run(), gw, Script(), planner)
    assert only_result(gw)["classification"]["caseId"] is None


def test_read_memory_is_answered_inside_the_ai_server() -> None:
    gw = FakeGateway()
    planner = Script(
        classify(None),
        call("read_memory", stage="apply"),
        final(
            status="needs_user", userRequest={"message": "DB 주소를 확인해 주세요"}, summary="DB"
        ),
    )
    solve(make_run(**SIGNALS["A2"]), gw, Script(), planner)
    [answer] = [
        p.content
        for p in planner.requests[2][-1].parts
        if isinstance(p, ToolReturnPart) and p.tool_name == "read_memory"
    ]
    # 도구 결과의 타입은 PydanticAI가 여러 모양의 합으로 두므로, 우리 도구가 돌려준 모양으로 읽는다.
    cases = cast(dict[str, Any], answer)["cases"]
    assert [c["caseId"] for c in cases] == ["A3", "A4", "A1", "A2"]
    assert gw.tool_calls() == [] and only_result(gw)["actions"] == []


def test_a_plan_with_a_tool_the_platform_does_not_have_is_made_again() -> None:
    gw = FakeGateway()
    planner = Script(
        classify("A1"),
        plan({"tool": "read_build_logs"}, FINISH),
        plan(FINISH),
        final(status="gave_up", summary="모름"),
    )
    local = Script(final(status="gave_up", summary="모름"))
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    assert "unknown tools ['read_build_logs']" in planner.sent(2)


def test_a_plan_with_edit_args_outside_files_is_made_again() -> None:
    gw = FakeGateway()
    edit = {"tool": "edit_repo_file", "args": {"path": "server.js", "find": "a", "replace": "b"}}
    planner = Script(
        classify("A2"),
        plan(edit, FINISH),
        plan(FINISH),
        final(status="gave_up", summary="모름"),
    )
    local = Script(final(status="gave_up", summary="모름"))
    solve(make_run(**SIGNALS["A2"]), gw, local, planner)
    assert "put each file inside files" in planner.sent(2)
    assert "files: [{ path, find, replace }], message" in planner.sent(1)


# ---- ④ 재계획 ----


def test_a_local_gave_up_is_replanned_by_the_planner() -> None:
    gw = FakeGateway()
    gw.script["run_deploy"] = [{"ok": False, "services": [], "pods": [], "events": []}]
    patch = [{"op": "replace", "path": "/spec/services/0/runtime/health/path", "value": "/healthz"}]
    local = Script(
        call("run_render", specPatch=PORT_PATCH),
        call("run_deploy", specPatch=PORT_PATCH),
        final(status="gave_up", summary="포트를 바꿔도 Ready가 되지 않음"),
    )
    planner = Script(
        classify("A1"),
        plan(*A1_STEPS),
        call("run_deploy", specPatch=patch),
        call("run_verify"),
        final(status="verified", specPatch=patch, summary="헬스체크 경로를 /healthz로 고쳤습니다."),
    )
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    result = only_result(gw)
    assert result["classification"] == {
        "method": "llm",
        "caseId": "A1",
        "path": "replan_after_playbook",
    }
    assert result["status"] == "verified" and result["specPatch"] == patch
    assert [(a["tool"], a["ok"]) for a in result["actions"]] == [
        ("run_render", True),
        ("run_deploy", False),
        ("run_deploy", True),
        ("run_verify", True),
    ]
    replan = planner.sent(2)
    assert "포트를 바꿔도 Ready가 되지 않음" in replan and "- run_deploy ok=False" in replan


@pytest.mark.parametrize("status", ["verified", "needs_user"])
def test_a_plan_that_did_not_give_up_is_not_replanned(status: str) -> None:
    gw = FakeGateway()
    extra: dict[str, Any] = (
        {"specPatch": []} if status == "verified" else {"userRequest": {"message": "x"}}
    )
    planner = Script(classify("A1"), plan(FINISH))
    solve(
        make_run(**SIGNALS["A1"]), gw, Script(final(status=status, summary="끝", **extra)), planner
    )
    assert only_result(gw)["classification"]["path"] == "playbook"
    assert planner.done


def test_a_rejection_while_executing_stops_the_local_model_and_the_planner_replans() -> None:
    # 2026-11-14 실서비스: 로컬 모델이 거절된 호출을 되풀이하다 TOOL_LIMIT에 닿았다.
    gw = FakeGateway()
    port = [{"path": "services[0].runtime.port", "code": "INVALID_TYPE"}]
    gw.script["run_render"] = [reject("INVALID_SPEC", "see fields", port)]
    as_text = [{"op": "replace", "path": "/spec/services/0/runtime/port", "value": "3000"}]
    planner = Script(
        classify("A1"),
        plan({"tool": "run_render", "args": {"specPatch": as_text}}, *A1_STEPS[1:]),
        *A1_RUN,
        final(status="verified", specPatch=PORT_PATCH, summary="포트를 숫자 3000으로 고쳤습니다."),
    )
    local = Script(call("run_render", specPatch=as_text))
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    result = only_result(gw)
    assert result["status"] == "verified" and result["specPatch"] == PORT_PATCH
    assert result["classification"]["path"] == "replan_after_playbook"
    # 로컬 모델은 거절을 받지 않았다(그 자리에서 멈췄다).
    assert local.done and len(local.requests) == 1
    replan = planner.sent(2)
    assert "rejected INVALID_SPEC: fields services[0].runtime.port:INVALID_TYPE" in replan
    assert "거절되어 멈췄습니다(거절: INVALID_SPEC)" in replan


def test_a_local_output_that_keeps_breaking_is_replanned() -> None:
    gw = FakeGateway()
    local = Script(*[final(status="verified", summary="x") for _ in range(3)])
    planner = planner_of(final(status="gave_up", summary="모름"))
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    result = only_result(gw)
    assert result["classification"]["path"] == "replan_after_playbook"
    assert planner.done and local.done


def test_model_that_never_answers_right_is_reported_as_gave_up() -> None:
    gw = FakeGateway()
    local = Script(*[final(status="verified", summary="x") for _ in range(3)])
    planner = planner_of(*[final(status="verified", summary="x") for _ in range(3)])
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    result = only_result(gw)
    assert result["status"] == "gave_up" and "AI 모델 호출이 실패" in result["summary"]
    assert result["classification"]["path"] == "replan_after_playbook"


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
    planner = Script(classify("A1"), plan(*A1_STEPS))
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    result = only_result(gw)
    assert result["status"] == "gave_up" and words in result["summary"]
    assert result["classification"] == {"method": "llm", "caseId": "A1", "path": "playbook"}
    assert result["actions"] == [
        {
            "tool": "run_render",
            "args": {"specPatch": PORT_PATCH},
            "ok": False,
            "result": f"rejected {code}: no more",
        }
    ]
    # 멈추면 재계획하지 않는다.
    assert planner.done


def test_closed_ticket_submits_nothing() -> None:
    gw = FakeGateway()
    gw.script["run_verify"] = [reject("TICKET_CLOSED")]
    solve(make_run(**SIGNALS["A1"]), gw, Script(call("run_verify")))
    assert gw.submitted == []


def test_rejections_while_the_planner_acts_go_back_to_the_planner() -> None:
    gw = FakeGateway()
    gw.script["run_render"] = [
        reject("PATCH_FORBIDDEN", "path /spec/services/0/role is not allowed")
    ]
    bad = [{"op": "replace", "path": "/spec/services/0/role", "value": "fe"}]
    planner = Script(
        classify(None),
        call("run_render", specPatch=bad),
        call("run_render", specPatch=PORT_PATCH),
        final(status="verified", specPatch=PORT_PATCH, summary="포트를 고쳤습니다."),
    )
    solve(make_run(), gw, Script(), planner)
    assert "PATCH_FORBIDDEN" in planner.sent(2) and "is not allowed" in planner.sent(2)
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
    planner = planner_of(final(status="gave_up", summary="502가 계속 납니다."))
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


# ---- 추론 모델 API: 가림 필터 (FR-102)와 로컬로 넘기기 ----

SECRET_LOG = "connect failed: postgres://app:hunter2pass@db:5432/app DATABASE_PASSWORD=s3cr3tvalue"


def test_planner_api_gets_redacted_text_and_local_model_does_not_need_it() -> None:
    gw = FakeGateway()
    gw.script["read_pod_logs"] = [{"lines": ["Authorization: Bearer abcdefghijklmnop1234"]}]
    api = Script(
        classify(None),
        call("read_pod_logs", service="be"),
        final(status="gave_up", summary="DB에 닿지 않습니다."),
    )
    local = Script()
    logs = {"from": "2026-11-10T13:02:00Z", "to": "2026-11-10T13:12:00Z", "lines": [SECRET_LOG]}
    solve(make_run(logs=logs), gw, local, models=make_models(local.model, api.model))
    for i in range(3):
        sent = api.sent(i)
        for secret in ("hunter2pass", "s3cr3tvalue", "abcdefghijklmnop1234", "gw_tok"):
            assert secret not in sent
    assert "postgres://app:[REDACTED]@db" in api.sent(0)
    assert "Bearer [REDACTED]" in api.sent(2)
    # 가림은 모델로 가는 글에만 한다. 게이트웨이에 낸 결과의 기록은 원본이다.
    assert only_result(gw)["actions"][0]["result"].count("abcdefghijklmnop1234") == 1


def test_the_local_model_gets_the_ticket_unredacted() -> None:
    gw = FakeGateway()
    logs = {"from": "2026-11-10T13:02:00Z", "to": "2026-11-10T13:12:00Z", "lines": [SECRET_LOG]}
    api = Script(classify("A1"), plan(FINISH), final(status="gave_up", summary="모름"))
    local = Script(final(status="gave_up", summary="모름"))
    run = make_run(**{**SIGNALS["A1"], "logs": logs})
    solve(run, gw, local, models=make_models(local.model, api.model))
    # 로컬 모델은 클러스터 안이라 가리지 않는다.
    assert "hunter2pass" in local.sent(0)


def test_planner_api_failure_falls_back_to_the_local_model() -> None:
    gw = FakeGateway()
    local = Script(classify(None), final(status="gave_up", summary="로컬 모델로 계획했습니다."))
    api = Script(fail(ModelHTTPError(503, "reasoner")), fail(ModelHTTPError(503, "reasoner")))
    solve(make_run(), gw, local, models=make_models(local.model, api.model))
    assert local.done
    assert only_result(gw)["summary"] == "로컬 모델로 계획했습니다."


def test_without_a_planner_api_the_whole_run_is_local() -> None:
    gw = FakeGateway()
    local = Script(
        classify("A1"),
        plan(FINISH),
        final(status="needs_user", userRequest={"message": "x"}, summary="로컬"),
    )
    solve(make_run(**SIGNALS["A1"]), gw, local, models=make_models(local.model, None))
    assert local.done and only_result(gw)["classification"]["path"] == "playbook"


# ---- 접수 API에서 끝까지 ----


def test_ticket_posted_to_the_api_ends_in_submit_result(settings: Settings) -> None:
    gw = FakeGateway()
    local = Script(call("run_verify"), final(status="verified", specPatch=[], summary="통과"))
    tokens: list[str] = []

    def gateway_for(token: str) -> Any:
        tokens.append(token)
        return gw.toolset()

    runner = make_agent_runner(Models(local=local.model, planner=planner_of().model), gateway_for)
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
    planner = planner_of()
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    result = only_result(gw)
    assert result["status"] == "gave_up"
    assert result["summary"].startswith("플랫폼 게이트웨이에 닿지 못해 멈췄습니다")
    # 분류 · 계획 뒤에는 추론 모델을 다시 부르지 않는다.
    assert gw.lost == ["run_render"] and len(planner.requests) == 2


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
    solve(make_run(**SIGNALS["A1"]), gw, local, planner_of(final(status="gave_up", summary="모름")))
    assert len(gw.submitted) == (2 if code == "INVALID_RESULT" else 1)
    assert f"result not delivered: submit_result rejected {code}" in caplog.text


def test_repeated_rejections_are_not_called_a_model_failure() -> None:
    gw = FakeGateway()
    gw.script["run_render"] = [reject("PATCH_FORBIDDEN", "role is not allowed")] * 5
    bad = [{"op": "replace", "path": "/spec/services/0/role", "value": "fe"}]
    local = Script(call("run_render", specPatch=bad))
    planner = planner_of(*[call("run_render", specPatch=bad) for _ in range(4)])
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    result = only_result(gw)
    assert result["status"] == "gave_up"
    assert result["summary"].startswith(
        "배포 설정 수정이 플랫폼 검사에서 계속 거절되어 멈췄습니다(마지막 거절: PATCH_FORBIDDEN)"
    )
    assert "AI 모델 호출이 실패" not in result["summary"]
    # 로컬 실행이 거절되면 추론 모델이 다시 계획했다.
    assert result["classification"]["path"] == "replan_after_playbook"
    assert len(result["actions"]) == 5


def test_field_errors_survive_the_replan_prompt_clip_before_a_long_message() -> None:
    gw = FakeGateway()
    fields = [
        {"path": "services[0].runtime.port", "code": "INVALID_TYPE"},
        {"path": "services[0].runtime.health.port", "code": "UNKNOWN_KEY"},
    ]
    gw.script["run_render"] = [reject("INVALID_SPEC", "x" * 400, fields)]
    local = Script(call("run_render", specPatch=PORT_PATCH))
    planner = planner_of(final(status="gave_up", summary="모름"))
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    replan = planner.sent(2)
    assert "services[0].runtime.port:INVALID_TYPE" in replan
    assert "services[0].runtime.health.port:UNKNOWN_KEY" in replan


def test_field_errors_longer_than_the_replan_clip_are_marked_as_cut() -> None:
    gw = FakeGateway()
    fields = [
        {"path": f"services[0].runtime.env[{i}].value", "code": "INVALID_TYPE"} for i in range(12)
    ]
    gw.script["run_render"] = [reject("INVALID_SPEC", "see fields", fields)]
    local = Script(call("run_render", specPatch=PORT_PATCH))
    planner = planner_of(final(status="gave_up", summary="모름"))
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    replan = planner.sent(2)
    # 앞쪽 칸은 남고, 잘린 뒤쪽은 잘렸다고 적힌다(조용히 사라지지 않는다).
    assert "services[0].runtime.env[0].value:INVALID_TYPE" in replan
    assert "services[0].runtime.env[11].value" not in replan
    assert "…[truncated " in replan


def test_the_plan_prompt_says_a_port_is_a_number() -> None:
    gw = FakeGateway()
    planner = planner_of(final(status="gave_up", summary="모름"))
    solve(make_run(**SIGNALS["A1"]), gw, Script(final(status="gave_up", summary="모름")), planner)
    sent = planner.sent(1)
    assert "JSON type that field takes" in sent and 'numbers (3000, not "3000")' in sent


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


def test_verify_ticket_is_planned_from_the_v2_playbook() -> None:
    gw = FakeGateway()
    patch = [{"op": "replace", "path": "/spec/services/0/runtime/stripPrefix", "value": True}]
    planner = Script(
        classify("V2"),
        plan(
            {"tool": "run_deploy", "args": {"specPatch": patch}},
            {"tool": "run_verify"},
            {"tool": "submit_result", "when": "verified"},
        ),
    )
    local = Script(
        call("run_deploy", specPatch=patch),
        call("run_verify"),
        final(
            status="verified",
            specPatch=patch,
            summary="앱이 /api 없이 받아 stripPrefix를 켰습니다.",
        ),
    )
    solve(make_run(**SIGNALS["V2"]), gw, local, planner)
    result = only_result(gw)
    assert result["classification"] == {"method": "llm", "caseId": "V2", "path": "playbook"}
    assert result["specPatch"] == patch
    # 게이트웨이가 verified를 받는 조건(api.md 5번):
    # 같은 specPatch로 run_deploy → 그 뒤 run_verify 통과.
    assert gw.tool_calls() == ["run_deploy", "run_verify"]
    assert dict(gw.calls)["run_deploy"] == {"specPatch": patch}
    # 게이트웨이 검사(BE/src/gateway/result.ts)가 아는 칸만 보낸다.
    gateway_keys = {
        "ticketId", "commitSha", "status", "classification", "actions", "specPatch",
        "buildOverrides", "pr", "userRequest", "evidence", "summary",
    }  # fmt: skip
    assert set(result) <= gateway_keys
    first = planner.sent(1)
    # verify 티켓은 통과하지 못한 검사를 errorMessage로, 그 서비스의 Pod를 raw.k8s로 싣는다.
    assert '"caseId":"V2"' in first and "Error: be: GET /api/health -> 404" in first
    assert "stage=verify" in first


# ---- 수정 PR (F13, FR-077) ----

SOURCE = {"commitSha": "b" * 40}
FIX_FILES = [{"path": "FE/src/App.tsx", "content": "import Header from './Components/Header'\n"}]
PR_URL = "https://github.com/student/app/pull/1"


def test_a_code_fix_is_edit_then_the_same_source_through_build_deploy_verify_then_open_pr() -> None:
    gw = FakeGateway()
    local = Script(
        call("edit_repo_file", files=FIX_FILES, message="fix: import 대소문자"),
        call("run_build", service="fe", source=SOURCE),
        call("run_deploy", source=SOURCE),
        call("run_verify"),
        call("open_pr", source=SOURCE, title="fix: import 대소문자", body="경로를 맞췄습니다."),
        final(
            status="pr_opened",
            pr={"url": PR_URL, "files": ["FE/src/App.tsx"], "changedLines": 2},
            summary="import 경로의 대소문자가 달라 빌드가 실패했습니다. PR을 열었습니다.",
        ),
    )
    solve(make_run(**SIGNALS["B4"]), gw, local)
    assert gw.tool_calls() == [
        "edit_repo_file",
        "run_build",
        "run_deploy",
        "run_verify",
        "open_pr",
    ]
    calls = dict(gw.calls)
    assert calls["run_build"]["source"] == SOURCE and calls["run_deploy"]["source"] == SOURCE
    assert calls["open_pr"]["source"] == SOURCE
    result = only_result(gw)
    assert result["status"] == "pr_opened"
    assert result["pr"] == {"url": PR_URL, "files": ["FE/src/App.tsx"], "changedLines": 2}
    # 실제로 한 호출이 모두 남는다(결과의 actions는 코드가 채운다).
    assert [a["tool"] for a in result["actions"]] == gw.tool_calls()


GAVE_UP = {"status": "gave_up", "summary": "모름"}
APP_FILE = {"type": "file", "path": "FE/src/App.tsx", "content": "import Header from './h'\n"}
B4_STEPS: list[dict[str, Any]] = [
    {"tool": "edit_repo_file", "args": {"files": FIX_FILES, "message": "fix: import 대소문자"}},
    {"tool": "run_build", "args": {"service": "fe", "source": "{source}"}},
    {"tool": "run_deploy", "args": {"source": "{source}"}},
    {"tool": "run_verify"},
    {"tool": "open_pr", "args": {"source": "{source}", "title": "fix", "body": "b"}},
    {"tool": "submit_result", "when": "open_pr가 url을 주면 pr_opened"},
]


def test_the_planner_reads_the_file_before_it_plans_the_whole_new_content() -> None:
    # 2026-11-14 운영 B4: 계획 단계에서 파일을 못 읽어 "읽고 needs_user"로 계획했다.
    gw = FakeGateway()
    gw.script["read_repo"] = [APP_FILE]
    planner = Script(classify("B4"), call("read_repo", path="FE/src/App.tsx"), plan(*B4_STEPS))
    local = Script(
        call("edit_repo_file", files=FIX_FILES, message="fix: import 대소문자"),
        call("run_build", service="fe", source=SOURCE),
        call("run_deploy", source=SOURCE),
        call("run_verify"),
        call("open_pr", source=SOURCE, title="fix", body="b"),
        final(status="pr_opened", pr={"url": PR_URL}, summary="import 경로를 고쳤습니다."),
    )
    solve(make_run(**SIGNALS["B4"]), gw, local, planner)
    # 읽기는 추론 모델이 계획 단계에서 하고, 로컬 모델은 계획의 도구만 부른다.
    assert gw.tool_calls() == [
        "read_repo",
        "edit_repo_file",
        "run_build",
        "run_deploy",
        "run_verify",
        "open_pr",
    ]
    assert "import Header from './h'" in planner.sent(2)
    assert "read_repo" not in {t.name for t in local.infos[0].function_tools}
    result = only_result(gw)
    assert result["status"] == "pr_opened" and result["classification"]["path"] == "playbook"
    # 계획 단계의 읽기도 실제 호출이라 기록에 남는다.
    assert [a["tool"] for a in result["actions"]] == gw.tool_calls()
    assert planner.done and local.done


def test_files_read_earlier_in_planning_stay_whole_for_the_plan() -> None:
    # 두 파일을 고치는 계획은 둘 다 전체 내용이 있어야 쓸 수 있다.
    gw = FakeGateway()
    other = {"type": "file", "path": "FE/src/main.tsx", "content": "import App from './App'\n"}
    # 요약은 짧은 값을 그대로 두므로 80자가 넘는 파일로 본다.
    long_file = {**APP_FILE, "content": "import Header from './h'\n" + "// x\n" * 40}
    gw.script["read_repo"] = [long_file, other]
    planner = Script(
        classify("B4"),
        call("read_repo", path="FE/src/App.tsx"),
        call("read_repo", path="FE/src/main.tsx"),
        plan(FINISH),
        final(**GAVE_UP),
    )
    solve(make_run(**SIGNALS["B4"]), gw, Script(final(**GAVE_UP)), planner)
    # 도구 결과는 JSON 글로 들어가므로 이스케이프된 모양으로 찾는다.
    assert json.dumps(long_file["content"])[1:-1] in planner.sent(3)


def test_a_read_rejected_while_planning_goes_back_to_the_planner() -> None:
    gw = FakeGateway()
    gw.script["read_repo"] = [reject("NOT_FOUND", "no such path")]
    planner = Script(
        classify("B4"),
        call("read_repo", path="FE/src/app.tsx"),
        plan({"tool": "submit_result", "when": "needs_user"}),
    )
    local = Script(
        final(status="needs_user", userRequest={"message": "파일을 확인해 주세요."}, summary="s")
    )
    solve(make_run(**SIGNALS["B4"]), gw, local, planner)
    # 계획 중 거절은 재계획(PlanBroken)이 아니라 추론 모델이 읽고 계획을 고친다.
    assert "gateway rejected read_repo: NOT_FOUND: no such path" in planner.sent(2)
    result = only_result(gw)
    assert result["status"] == "needs_user" and result["classification"]["path"] == "playbook"


def test_the_planner_api_gets_files_read_while_planning_redacted() -> None:
    gw = FakeGateway()
    gw.script["read_repo"] = [
        {"type": "file", "path": "BE/.env.example", "content": "DATABASE_PASSWORD=s3cr3tvalue\n"}
    ]
    api = Script(
        classify("B4"), call("read_repo", path="BE/.env.example"), plan(FINISH), final(**GAVE_UP)
    )
    local = Script(final(**GAVE_UP))
    solve(make_run(**SIGNALS["B4"]), gw, local, models=make_models(local.model, api.model))
    assert "s3cr3tvalue" not in api.sent(2) and "DATABASE_PASSWORD=[REDACTED]" in api.sent(2)


ENV_FILE = [{"path": ".env", "content": "A=1\n"}]


@pytest.mark.parametrize(
    ("tool", "args", "code"),
    [
        ("edit_repo_file", {"files": ENV_FILE, "message": "m"}, "EDIT_FORBIDDEN"),
        ("open_pr", {"source": SOURCE, "title": "t", "body": "b"}, "NOT_VERIFIED"),
        ("edit_repo_file", {"files": FIX_FILES, "message": "m"}, "BOT_UNAVAILABLE"),
    ],
)
def test_repository_tool_rejections_go_back_to_the_planner(
    tool: str, args: dict[str, Any], code: str
) -> None:
    gw = FakeGateway()
    gw.script[tool] = [reject(code, "refused for a reason")]
    local = Script(call(tool, **args))
    planner = planner_of(
        final(
            status="needs_user",
            userRequest={"message": "고칠 곳을 안내합니다."},
            summary="수정 PR을 만들지 못했습니다.",
        )
    )
    solve(make_run(**SIGNALS["B4"]), gw, local, planner)
    # 로컬 모델은 거절을 받지 않고, 추론 모델이 그 코드를 읽고 다시 계획한다.
    assert f"rejected {code}: refused for a reason" in planner.sent(2)
    result = only_result(gw)
    assert result["status"] == "needs_user"
    assert result["actions"][0]["ok"] is False
    assert result["actions"][0]["result"].startswith(f"rejected {code}")


def test_a_pull_request_the_student_repo_refused_is_reported_as_needs_user() -> None:
    gw = FakeGateway()
    gw.script["open_pr"] = [{"url": None, "patchAttached": True}]
    local = Script(
        call("edit_repo_file", files=FIX_FILES, message="fix: import"),
        call("run_deploy", source=SOURCE),
        call("run_verify"),
        call("open_pr", source=SOURCE, title="t", body="b"),
        final(
            status="needs_user",
            userRequest={
                "message": "PR을 열 수 없어 src/App.tsx의 import 대소문자를 고친 patch를 붙입니다."
            },
            summary="수정은 확인했지만 PR을 열지 못했습니다.",
        ),
    )
    solve(make_run(**SIGNALS["B4"]), gw, local)
    # 모델은 patch 글을 받지 않는다(플랫폼이 결과에 붙인다).
    assert "patchAttached" in local.sent(-1)
    assert only_result(gw)["status"] == "needs_user"


def test_the_instructions_tell_the_model_the_pull_request_rules() -> None:
    for text in (
        "open_pr is refused (NOT_VERIFIED)",
        "BOT_UNAVAILABLE",
        "`{ url: null, patchAttached: true }`",
        "Do not copy the patch",
        "the platform checks it",
        # D3(2026-11-14): run_render는 source를 받지 않아 수정 PR 경로에서 호출이 낭비됐다.
        "Skip run_render on this path",
    ):
        assert text in INSTRUCTIONS


# ---- 성능 정리(2026-11-14) ----


def test_gateway_tools_match_the_platform() -> None:
    # 대역 게이트웨이가 BE에 없는 도구를 열면 playbook의 없는 도구가 테스트에서 드러나지 않는다.
    gw = FakeGateway()
    local = Script(final(status="verified", specPatch=[], summary="통과"))
    solve(make_run(**SIGNALS["A1"]), gw, local)
    offered = {t.name for t in local.infos[0].function_tools}
    assert offered | {"submit_result"} == GATEWAY_TOOLS


def test_verified_carries_the_specpatch_that_passed_the_trial() -> None:
    # 모델이 결과에 다른 패치를 적어도 시험한 패치를 낸다(INVALID_RESULT 방지).
    gw = FakeGateway()
    other = [{"op": "replace", "path": "/spec/services/0/runtime/port", "value": 8080}]
    local = Script(
        call("run_deploy", specPatch=PORT_PATCH),
        call("run_verify"),
        final(status="verified", specPatch=other, summary="포트를 고쳤습니다."),
    )
    solve(make_run(**SIGNALS["A1"]), gw, local)
    assert only_result(gw)["specPatch"] == PORT_PATCH


def test_verified_after_a_failed_redeploy_keeps_the_model_patch() -> None:
    # 마지막 run_deploy가 실패했으면 앞의 확인은 쓰지 않는다(게이트웨이도 받지 않는다).
    gw = FakeGateway()
    gw.script["run_deploy"] = [{"ok": True}, {"ok": False}]
    local = Script(
        call("run_deploy", specPatch=PORT_PATCH),
        call("run_verify"),
        call("run_deploy", specPatch=[]),
        final(status="verified", specPatch=[], summary="고쳤습니다."),
    )
    solve(make_run(**SIGNALS["A1"]), gw, local)
    assert only_result(gw)["specPatch"] == []


def test_only_rerunning_is_verified_with_an_empty_patch() -> None:
    gw = FakeGateway()
    local = Script(
        call("run_deploy"),
        call("run_verify"),
        final(status="verified", specPatch=PORT_PATCH, summary="다시 실행해 통과했습니다."),
    )
    solve(make_run(**SIGNALS["A1"]), gw, local)
    assert only_result(gw)["specPatch"] == []


def test_instructions_match_the_gateway_rules() -> None:
    for gone in ("/spec/project/slug", "Retry a transient"):
        assert gone not in INSTRUCTIONS
    assert (
        "run_build 2, run_render 5, run_deploy 2, run_verify 3, edit_repo_file 5,\n"
        "  open_pr 2, 20 tool calls in all"
    ) in INSTRUCTIONS


def test_finish_steps_are_shown_as_results_not_tools() -> None:
    gw = FakeGateway()
    planner = Script(
        classify("B3"), plan({"tool": "submit_result", "when": "키가 없으면 needs_user"})
    )
    local = Script(
        final(status="needs_user", userRequest={"message": "키를 넣어 주세요"}, summary="키")
    )
    solve(make_run(**SIGNALS["B3"]), gw, local, planner)
    hint, executed = planner.sent(1), local.sent(0)
    assert '"finish":"값을 알 수 없거나 비밀값이면 needs_user로"' in hint
    assert '"finish":"키가 없으면 needs_user"' in executed
    assert '"tool":"submit_result"' not in hint + executed


def test_plan_prompt_says_the_ticket_already_has_the_logs() -> None:
    with_logs = {
        **SIGNALS["A1"],
        "logs": {
            "from": "2026-11-10T13:02:00Z",
            "to": "2026-11-10T13:12:00Z",
            "lines": ["listening on 3000"],
        },
    }
    for overrides, said in ((with_logs, True), (SIGNALS["A1"], False)):
        gw = FakeGateway()
        planner = planner_of(final(status="gave_up", summary="모름"))
        local = Script(final(status="gave_up", summary="모름"))
        solve(make_run(**overrides), gw, local, planner)
        assert ("already carries the latest log lines" in planner.sent(1)) is said
        # 계획 단계에서 읽는 것은 추론 모델 자신이다(계획의 단계가 아니다).
        assert ("skip reading the logs when they show the cause" in planner.sent(1)) is said


def test_replan_prompt_counts_the_calls_left() -> None:
    gw = FakeGateway()
    gw.script["run_deploy"] = [{"ok": False}]
    local = Script(
        call("run_render", specPatch=PORT_PATCH),
        call("run_deploy", specPatch=PORT_PATCH),
        final(status="gave_up", summary="안 됨"),
    )
    planner = planner_of(final(status="gave_up", summary="안 됨"))
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    assert "Calls left: run_build 2, run_render 5, run_deploy 2" in planner.sent(1)
    assert (
        "Calls left: run_build 2, run_render 4, run_deploy 1, run_verify 3, edit_repo_file 5, "
        "open_pr 2, 18 calls in all" in planner.sent(2)
    )


OTHER_PATCH = [{"op": "replace", "path": "/spec/services/0/runtime/port", "value": 8080}]


@pytest.mark.parametrize(
    ("tool", "outcome"),
    [("run_deploy", {"ok": False}), ("run_verify", {"ok": False, "failure": None})],
)
def test_a_failed_trial_does_not_replace_the_model_patch(
    tool: str, outcome: dict[str, Any]
) -> None:
    gw = FakeGateway()
    gw.script[tool] = [outcome]
    local = Script(
        call("run_deploy", specPatch=PORT_PATCH),
        call("run_verify"),
        final(status="verified", specPatch=OTHER_PATCH, summary="고쳤습니다."),
    )
    solve(make_run(**SIGNALS["A1"]), gw, local)
    assert only_result(gw)["specPatch"] == OTHER_PATCH


def test_only_verified_gets_the_trial_patch() -> None:
    gw = FakeGateway()
    local = Script(
        call("run_deploy", specPatch=PORT_PATCH),
        call("run_verify"),
        final(status="needs_user", userRequest={"message": "확인해 주세요"}, summary="확인"),
    )
    solve(make_run(**SIGNALS["A1"]), gw, local)
    assert "specPatch" not in only_result(gw)


# ---- 지어낸 env 값 막기 (2026-11-14 실서비스 B3: 비밀값에 지어낸 값으로 verified) ----

ENV_EXAMPLE = {
    "type": "file",
    "content": '# 비밀값\nVITE_API_KEY=\nVITE_THEME=light\nVITE_TITLE=say "hi"\n',
}


def _env_patch(key: str, value: Any, where: str = "build/buildEnv") -> list[dict[str, Any]]:
    return [{"op": "add", "path": f"/spec/services/0/{where}/{key}", "value": value}]


def _b3_run_with(patch: list[dict[str, Any]]) -> dict[str, Any]:
    gw = FakeGateway()
    gw.script["read_repo"] = [ENV_EXAMPLE]
    local = Script(
        call("read_repo", path=".env.example"),
        call("run_build", service="be", specPatch=patch),
        call("run_deploy", specPatch=patch),
        call("run_verify"),
        final(status="verified", specPatch=patch, summary="빌드 env를 넣어 통과했습니다."),
    )
    solve(make_run(**SIGNALS["B3"]), gw, local)
    return only_result(gw)


def test_an_env_value_found_in_no_evidence_turns_verified_into_needs_user() -> None:
    result = _b3_run_with(_env_patch("VITE_API_KEY", "sk-made-up-1234"))
    assert result["status"] == "needs_user"
    assert "specPatch" not in result or result["specPatch"] is None
    assert "VITE_API_KEY" in result["userRequest"]["message"]
    # 지어낸 값은 학생에게 보이는 글에 싣지 않는다(시도 기록 actions에는 인자로 남는다).
    shown = json.dumps([result["summary"], result["userRequest"]], ensure_ascii=False)
    assert "sk-made-up-1234" not in shown


def test_an_env_value_read_from_the_repository_stays_verified() -> None:
    patch = _env_patch("VITE_THEME", "light")
    result = _b3_run_with(patch)
    assert result["status"] == "verified"
    assert result["specPatch"] == patch


def test_an_env_value_the_planner_read_while_planning_stays_verified() -> None:
    # 계획 단계의 읽기도 증거다(gateway.seen). 로컬 모델이 다시 읽지 않아도 지어낸 값이 아니다.
    patch = _env_patch("VITE_THEME", "light")
    gw = FakeGateway()
    gw.script["read_repo"] = [ENV_EXAMPLE]
    planner = Script(
        classify("B3"),
        call("read_repo", path=".env.example"),
        plan(
            {"tool": "run_build", "args": {"service": "be", "specPatch": patch}},
            {"tool": "run_deploy", "args": {"specPatch": patch}},
            {"tool": "run_verify"},
            {"tool": "submit_result", "when": "verified"},
        ),
    )
    local = Script(
        call("run_build", service="be", specPatch=patch),
        call("run_deploy", specPatch=patch),
        call("run_verify"),
        final(status="verified", specPatch=patch, summary="빌드 env를 넣어 통과했습니다."),
    )
    solve(make_run(**SIGNALS["B3"]), gw, local, planner)
    assert gw.tool_calls()[0] == "read_repo"
    assert only_result(gw)["status"] == "verified"


@pytest.mark.parametrize(
    "patch",
    [
        _env_patch("API_TOKEN", "made-up", where="runtime/env"),
        [{"op": "replace", "path": "/spec/services/0/build/buildEnv", "value": {"K": "made-up"}}],
        [{"op": "add", "path": "/spec/services/0/runtime/env", "value": {"K": "made-up"}}],
    ],
)
def test_runtime_env_and_whole_env_objects_are_checked_too(patch: list[dict[str, Any]]) -> None:
    assert _b3_run_with(patch)["status"] == "needs_user"


def test_non_env_values_are_not_checked() -> None:
    # 포트 같은 값은 증거에서 그대로 오지 않아도 된다(문자열이 아니다).
    patch = [{"op": "replace", "path": "/spec/services/0/build/nodeVersion", "value": "22"}]
    assert _b3_run_with(patch)["status"] == "verified"


@pytest.mark.parametrize(
    "patch",
    [
        _env_patch("VITE_TITLE", 'say "hi"'),
        [
            {
                "op": "add",
                "path": "/spec/services/0/build/buildEnv",
                "value": {"VITE_THEME": "light"},
            }
        ],
        [{"op": "remove", "path": "/spec/services/0/build/buildEnv/OLD_KEY"}],
        # 게이트웨이가 모양을 검사한다. 객체가 아닌 값이 와도 결과를 잃지 않는다.
        [{"op": "replace", "path": "/spec/services/0/runtime/env", "value": None}],
    ],
)
def test_values_from_the_repository_and_removals_stay_verified(patch: list[dict[str, Any]]) -> None:
    assert _b3_run_with(patch)["status"] == "verified"


def test_a_needs_user_from_the_model_keeps_its_own_request() -> None:
    gw = FakeGateway()
    patch = _env_patch("VITE_API_KEY", "made-up")
    request = {"message": "VITE_API_KEY를 넣어 주세요.", "secretKeys": []}
    local = Script(
        final(status="needs_user", specPatch=patch, userRequest=request, summary="키 없음")
    )
    solve(make_run(**SIGNALS["B3"]), gw, local)
    assert only_result(gw)["userRequest"]["message"] == request["message"]


# ---- 게이트웨이 결과 검사에 맞추기 (2026-11-14 실측: pr_opened 6/6이 INVALID_RESULT로 거절) ----


def _finish_with(status: str, steps: tuple[Step, ...] = (), **fields: Any) -> dict[str, Any]:
    gw = FakeGateway()
    local = Script(*steps, final(status=status, summary="끝", **fields))
    solve(make_run(**SIGNALS["A1"]), gw, local, planner_of(final(status="gave_up", summary="x")))
    return gw.submitted[0]


@pytest.mark.parametrize(
    ("status", "fields"),
    [
        ("needs_user", {"userRequest": {"message": "키를 넣어 주세요"}}),
        ("gave_up", {}),
        ("pr_opened", {"pr": {"url": PR_URL}}),
    ],
)
def test_spec_patch_and_build_overrides_are_dropped_from_a_result_that_is_not_verified(
    status: str, fields: dict[str, Any]
) -> None:
    # 게이트웨이는 verified가 아닌 결과의 specPatch · buildOverrides를 비어 있어도 거절한다.
    sent = _finish_with(status, specPatch=[], buildOverrides={"computeType": "SMALL"}, **fields)
    assert sent["status"] == status
    assert "specPatch" not in sent and "buildOverrides" not in sent


def test_pr_opened_carries_the_url_open_pr_returned() -> None:
    sent = _finish_with(
        "pr_opened",
        (call("open_pr", source=SOURCE, title="t", body="b"),),
        pr={"url": "https://github.com/student/app/pull/99", "files": ["a"], "changedLines": 1},
    )
    assert sent["pr"]["url"] == PR_URL  # 대역 게이트웨이의 open_pr가 돌려준 주소


def test_verified_keeps_its_spec_patch() -> None:
    sent = _finish_with(
        "verified",
        (call("run_deploy", specPatch=PORT_PATCH), call("run_verify")),
        specPatch=PORT_PATCH,
    )
    assert sent["specPatch"] == PORT_PATCH


def test_an_invalid_result_logs_the_gateway_reason(caplog: pytest.LogCaptureFixture) -> None:
    gw = FakeGateway()
    gw.script["submit_result"] = [reject("INVALID_RESULT", "pr_opened needs pr.url to be the url")]
    local = Script(final(status="gave_up", summary="모름"))
    solve(make_run(**SIGNALS["A1"]), gw, local, planner_of(final(status="gave_up", summary="x")))
    assert "pr_opened needs pr.url to be the url" in caplog.text


def test_an_invalid_result_log_hides_secret_looking_strings_the_model_put_in_a_path(
    caplog: pytest.LogCaptureFixture,
) -> None:
    # spec-patch.ts는 `${op.path}: no such key`를 돌려주고, op.path는 모델이 만든다.
    gw = FakeGateway()
    leaked = "ghp_" + "a" * 36
    gw.script["submit_result"] = [
        reject(
            "INVALID_RESULT",
            f"/services/0/runtime/env/{leaked}: no such key; API_KEY=hunter2secret",
        )
    ]
    local = Script(final(status="gave_up", summary="모름"))
    solve(make_run(**SIGNALS["A1"]), gw, local, planner_of(final(status="gave_up", summary="x")))
    assert "no such key" in caplog.text
    assert leaked not in caplog.text
    assert "hunter2secret" not in caplog.text
