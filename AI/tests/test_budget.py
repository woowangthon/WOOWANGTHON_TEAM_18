"""로컬 모델 16K 컨텍스트 예산: 받을 때 자르기, 프롬프트 요약본, 대화 기록 요약."""

import asyncio
import json
from typing import Any

from pydantic import AnyHttpUrl
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.openai import OpenAIChatModel

from ai_server.agent import budget, loop
from ai_server.agent.loop import Models, make_agent_runner, models_from_settings
from ai_server.agent.memory import CaseMemory, load_cases
from ai_server.agent.models import Ticket
from ai_server.agent.prompts import digest
from ai_server.agent.redact import RedactingModel
from ai_server.config import Settings
from tests.fake_gateway import FakeGateway
from tests.samples import ticket
from tests.scripted import Script, call, final, text_of
from tests.test_agent_loop import FINISH, classify, make_run, plan
from tests.test_memory import SIGNALS

LOG_TIME = {"from": "2026-11-10T13:02:00Z", "to": "2026-11-10T13:12:00Z"}


def big_pod(restarts: int = 7) -> dict[str, Any]:
    return {
        "metadata": {
            "name": "be-b-7d9f",
            "annotations": {f"note-{i}": "x" * 500 for i in range(100)},
            "labels": {"app": "be"},
        },
        "spec": {
            "containers": [
                {"name": "be", "env": [{"name": f"E{i}", "value": "v" * 200} for i in range(80)]}
            ]
        },
        "status": {
            "phase": "Running",
            "containerStatuses": [
                {
                    "name": "be",
                    "ready": False,
                    "restartCount": restarts,
                    "image": "ghcr.io/x/be@sha256:1",
                    "state": {
                        "waiting": {"reason": "CrashLoopBackOff", "message": "back-off 5m0s"}
                    },
                    "lastState": {"terminated": {"exitCode": 137, "reason": "OOMKilled"}},
                }
            ],
        },
    }


def noisy_events(n: int = 300) -> list[dict[str, Any]]:
    events = [
        {
            "reason": "Pulled",
            "message": "Container image already present " + "y" * 900,
            "type": "Normal",
            "involvedObject": {"kind": "Pod", "name": "be-b-7d9f"},
            "metadata": {"uid": str(i)},
        }
        for i in range(n)
    ]
    events.append(
        {
            "reason": "Unhealthy",
            "message": "Readiness probe failed: "
            'Get "http://10.42.0.5:8080/health": connection refused',
            "type": "Warning",
        }
    )
    return events


def long_log(n: int = 200, width: int = 2000) -> list[str]:
    lines = [f"{i:03d} info request handled " + "z" * width for i in range(n)]
    # 오류 줄은 24KB 자르기 뒤에도 남는 끝쪽에 둔다(앞쪽 줄은 받을 때 버려진다).
    lines[160] = "Error: connect ECONNREFUSED 10.0.0.5:5432 " + "e" * width
    lines[185] = "npm ERR! code ELIFECYCLE"
    return lines


def big_ticket(**overrides: Any) -> Ticket:
    t = ticket(
        raw={
            "codebuild": None,
            "k8s": {"pod": big_pod(), "events": noisy_events(), "status": None},
        },
        logs={**LOG_TIME, "lines": long_log()},
        errorMessage="deployment be-b exceeded its progress deadline " + "q" * 3000,
    )
    t.update(overrides)
    return Ticket.model_validate(t)


# ---- 받을 때 자르기 ----


def test_clip_line() -> None:
    assert budget.clip_line("a" * 400) == "a" * 400
    assert budget.clip_line("a" * 401) == "a" * 400 + "…[truncated 1 chars]"


def test_clip_log_keeps_the_last_lines_within_24kb() -> None:
    lines, notes = budget.clip_log(long_log())
    assert all(len(line) <= 400 + len("…[truncated 9999 chars]") for line in lines)
    assert sum(len(line.encode()) + 1 for line in lines) <= 24_000
    assert lines[-1].startswith("199 ")
    assert 0 < len(lines) < 200
    assert notes == [
        "199 log lines cut to 400 chars",
        f"first {200 - len(lines)} log lines dropped (24KB limit)",
    ]


def test_small_log_is_untouched() -> None:
    assert budget.clip_log(["a", "b"]) == (["a", "b"], [])


def test_trim_ticket_reduces_big_raw_to_key_fields() -> None:
    t, notes = budget.trim_ticket(big_ticket())
    assert t.raw.k8s is not None and t.raw.k8s.pod is not None
    assert t.raw.k8s.pod == budget.essential_pod(big_pod())
    assert (
        t.raw.k8s.pod["status"]["containerStatuses"][0]["lastState"]["terminated"]["reason"]
        == "OOMKilled"
    )
    assert len(t.raw.k8s.events) == budget.EVENTS_MAX
    assert t.raw.k8s.events[-1]["reason"] == "Unhealthy"  # 최근 것이 남는다
    assert set(t.raw.k8s.events[0]) == {"type", "reason", "message", "involvedObject"}
    assert len(t.error_message) < 450
    assert "raw.k8s.pod reduced to its key fields (6000 chars limit)" in notes
    assert "raw.k8s.events reduced to its key fields (6000 chars limit)" in notes
    assert any("log lines dropped" in n for n in notes)


def test_trim_ticket_leaves_a_small_ticket_alone() -> None:
    original = Ticket.model_validate(ticket())
    t, notes = budget.trim_ticket(original)
    assert notes == [] and t == original


def test_trim_ticket_reduces_codebuild_and_status() -> None:
    build = {
        "buildStatus": "FAILED",
        "currentPhase": "COMPLETED",
        "environment": {"variables": [{"name": f"V{i}", "value": "w" * 300} for i in range(60)]},
        "phases": [
            {"phaseType": "INSTALL", "phaseStatus": "SUCCEEDED", "contexts": []},
            {
                "phaseType": "BUILD",
                "phaseStatus": "FAILED",
                "contexts": [{"statusCode": "COMMAND_EXECUTION_ERROR", "message": "exit status 1"}],
            },
        ],
    }
    t, notes = budget.trim_ticket(
        Ticket.model_validate(ticket(stage="build", raw={"codebuild": build, "k8s": None}))
    )
    assert t.raw.codebuild == budget.essential_build(build)
    assert notes == ["raw.codebuild reduced to its key fields (6000 chars limit)"]
    status = {
        "kind": "Status",
        "code": 422,
        "reason": "Invalid",
        "message": "m",
        "details": {"causes": [{"field": "metadata.name", "message": "c" * 50}], "x": "p" * 7000},
    }
    k8s: dict[str, Any] = {"pod": None, "events": [], "status": status}
    t, _ = budget.trim_ticket(
        Ticket.model_validate(ticket(stage="render", raw={"codebuild": None, "k8s": k8s}))
    )
    assert t.raw.k8s is not None and t.raw.k8s.status == budget.essential_status(status)


def test_excerpt_takes_error_context_and_the_tail() -> None:
    lines = [f"line {i}" for i in range(200)]
    lines[10] = "Error: boom"
    lines[100] = "something failed"
    shown = budget.excerpt(lines)
    kept = [s for s in shown if s != "…"]
    assert kept[:5] == [f"line {i}" if i not in (10,) else "Error: boom" for i in range(8, 13)]
    assert "something failed" in kept and "line 98" in kept and "line 102" in kept
    assert kept[-20:] == [f"line {i}" for i in range(180, 200)]
    assert shown[0] == "…" and shown.count("…") == 3
    assert len(kept) == 30


def test_excerpt_is_at_most_60_lines_of_200_chars() -> None:
    lines = [f"Error {i} " + "x" * 500 for i in range(200)]
    kept = [s for s in budget.excerpt(lines) if s != "…"]
    assert len(kept) == 60
    assert all(len(s) <= 200 + len("…[truncated 999 chars]") for s in kept)


def test_trim_tool_result() -> None:
    small = {"ok": True, "lines": ["a"]}
    assert budget.trim_tool_result(small) == small
    assert budget.trim_tool_result("text") == "text"
    out = budget.trim_tool_result(
        {"lines": long_log(), "pods": [big_pod()] * 3, "events": noisy_events()}
    )
    assert out["pods"] == [budget.essential_pod(big_pod())] * 3
    # 이벤트는 reason · message만, 같은 것은 한 번, 최근 10개
    assert out["events"][-1]["reason"] == "Unhealthy"
    assert len(out["events"]) == 2 and set(out["events"][0]) == {"reason", "message"}
    assert len([s for s in out["lines"] if s != "…"]) <= 60
    assert out["_truncated"][0].startswith("lines: showing ")


# ---- 대화 기록 ----


def _turns() -> list[ModelMessage]:
    return [
        ModelRequest(parts=[UserPromptPart("fix it")]),
        ModelResponse(parts=[ToolCallPart("read_pod_logs", {}, tool_call_id="1")]),
        ModelRequest(
            parts=[ToolReturnPart("read_pod_logs", {"lines": ["x"] * 60}, tool_call_id="1")]
        ),
        ModelResponse(parts=[ToolCallPart("run_deploy", {}, tool_call_id="2")]),
        ModelRequest(
            parts=[
                ToolReturnPart("run_deploy", {"ok": False, "services": [1, 2]}, tool_call_id="2")
            ]
        ),
    ]


def test_only_the_latest_tool_result_stays_whole() -> None:
    turns = _turns()
    out = budget.compact_history(turns)
    older = out[2].parts[0]
    assert isinstance(older, ToolReturnPart)
    assert older.content == "read_pod_logs (earlier result, summarized): lines=[60]"
    latest = out[4].parts[0]
    assert isinstance(latest, ToolReturnPart)
    assert latest.content == {"ok": False, "services": [1, 2]}
    assert out[0] is turns[0]


def test_one_line_summary() -> None:
    line = budget.one_line(
        "run_verify", {"ok": False, "requests": [1], "error": "e" * 200, "_truncated": ["x"]}
    )
    assert (
        line
        == "run_verify (earlier result, summarized): ok=False requests=[1] error="
        + "e" * 80
        + "…[truncated 120 chars]"
    )
    assert budget.one_line("x", "already a summary") == "already a summary"


# ---- 로컬 모델 입력이 예산 안인가 ----


def request_chars(script: Script, i: int) -> int:
    info = script.infos[i]
    tools = [t.parameters_json_schema for t in [*info.function_tools, *info.output_tools]]
    return len(text_of(script.requests[i])) + len(json.dumps(tools))


def huge_gateway() -> FakeGateway:
    gw = FakeGateway()
    gw.script["read_pod_logs"] = [{"lines": long_log()}]
    gw.script["get_target_status"] = [
        {"pods": [big_pod()] * 3, "events": noisy_events(), "rollouts": []}
    ]
    gw.script["run_deploy"] = [
        {"ok": False, "services": [], "pods": [big_pod()] * 3, "events": noisy_events()}
    ]
    return gw


def test_local_model_input_stays_in_budget_with_a_big_ticket_and_big_results() -> None:
    gw = huge_gateway()
    local = Script(
        call("read_pod_logs", service="be", lines=200),
        call("get_target_status"),
        call("run_deploy"),
        call("read_pod_logs", service="be"),
        final(status="gave_up", summary="모름"),
    )
    planner = Script(
        classify("A3"), plan(), call("get_target_status"), final(status="gave_up", summary="모름")
    )
    run = make_run()
    run.ticket = big_ticket(
        **{
            "raw": {
                "codebuild": None,
                "k8s": {"pod": big_pod(), "events": noisy_events(), "status": None},
            }
        }
    )
    memory = CaseMemory(load_cases())
    asyncio.run(
        make_agent_runner(Models(local.model, planner.model), lambda t: gw.toolset())(run, memory)
    )
    # 정규식 힌트는 자르기 전 원본으로 만든다. 큰 Pod가 OOMKilled라 A3가 A1보다 먼저 맞는다.
    assert "Regex hint (may be wrong): A3" in planner.sent(0) and run.case_id == "A3"
    sizes = [request_chars(local, i) for i in range(len(local.requests))]
    assert len(sizes) == 5
    assert max(sizes) <= budget.LOCAL_INPUT_CHARS, sizes
    # 추론 API가 실패하면 추론 모델 요청도 로컬 모델로 넘어가므로 같은 예산 안이어야 한다.
    assert all(
        request_chars(planner, i) <= budget.LOCAL_INPUT_CHARS for i in range(len(planner.requests))
    )
    # 자른 사실이 모델에 보인다.
    assert "Cut on receipt:" in local.sent(0) and "_truncated" in local.sent(1)


def test_a_plan_at_its_size_limit_still_fits_the_local_budget() -> None:
    gw = huge_gateway()
    content = "x" * (loop.PLAN_CHARS - 400)
    edit = {"tool": "edit_repo_file", "args": {"files": [{"path": "a.ts", "content": content}]}}
    planner = Script(classify("A3"), plan(edit, FINISH))
    local = Script(final(status="needs_user", userRequest={"message": "x"}, summary="모름"))
    run = make_run()
    run.ticket = big_ticket(
        raw={"codebuild": None, "k8s": {"pod": big_pod(), "events": noisy_events(), "status": None}}
    )
    asyncio.run(
        make_agent_runner(Models(local.model, planner.model), lambda t: gw.toolset())(
            run, CaseMemory(load_cases())
        )
    )
    assert request_chars(local, 0) <= budget.LOCAL_INPUT_CHARS
    assert request_chars(planner, 1) <= budget.LOCAL_INPUT_CHARS


def test_a_plan_longer_than_the_limit_is_made_again() -> None:
    gw = FakeGateway()
    edit = {"tool": "edit_repo_file", "args": {"files": [{"path": "a", "content": "x" * 9000}]}}
    planner = Script(
        classify("A1"), plan(edit, FINISH), plan(FINISH), final(status="gave_up", summary="x")
    )
    local = Script(final(status="gave_up", summary="모름"))
    asyncio.run(
        make_agent_runner(Models(local.model, planner.model), lambda t: gw.toolset())(
            make_run(**SIGNALS["A1"]), CaseMemory(load_cases())
        )
    )
    assert "longer than 8000 characters" in planner.sent(2)


def test_classification_input_stays_in_budget() -> None:
    gw = FakeGateway()
    local = Script(final(case_id=None), final(status="gave_up", summary="모름"))
    run = make_run()
    pod = big_pod()
    pod["status"]["containerStatuses"][0]["lastState"] = {}
    pod["status"]["containerStatuses"][0]["state"] = {"running": {}}
    run.ticket = big_ticket(
        raw={"codebuild": None, "k8s": {"pod": pod, "events": noisy_events()[:-1], "status": None}}
    )
    asyncio.run(
        make_agent_runner(Models(local.model, local.model), lambda t: gw.toolset())(
            run, CaseMemory(load_cases())
        )
    )
    assert run.case_id is None
    assert all(request_chars(local, i) <= budget.LOCAL_INPUT_CHARS for i in range(2))


def test_digest_has_the_parts_the_local_model_needs() -> None:
    t, notes = budget.trim_ticket(big_ticket())
    text = digest(t, notes)
    assert "stage=apply service=be targetSlot=b" in text
    assert (
        "- be: waiting (CrashLoopBackOff), ready=False, restarts=7, last exit=137 reason=OOMKilled"
        in text
    )
    assert "- Unhealthy: Readiness probe failed" in text
    assert text.count("- Pulled:") == 1  # 같은 이벤트는 한 번만
    assert "Error: connect ECONNREFUSED" in text and "npm ERR! code ELIFECYCLE" in text
    assert "Cut on receipt:" in text
    assert "note-1" not in text and "E79" not in text  # 큰 원본의 필요 없는 칸은 없다


def test_digest_shows_render_status_and_failed_build_phases() -> None:
    status = {
        "code": 422,
        "reason": "Invalid",
        "message": "Deployment is invalid",
        "details": {"causes": [{"field": "metadata.name", "message": "a DNS-1035 label"}]},
    }
    t = Ticket.model_validate(
        ticket(
            stage="render",
            raw={"codebuild": None, "k8s": {"pod": None, "events": [], "status": status}},
        )
    )
    text = digest(t, [])
    assert "code=422 reason=Invalid" in text and "  - metadata.name: a DNS-1035 label" in text
    build = {
        "buildStatus": "FAILED",
        "phases": [
            {"phaseType": "INSTALL", "phaseStatus": "SUCCEEDED"},
            {
                "phaseType": "BUILD",
                "phaseStatus": "FAILED",
                "contexts": [{"message": "exit status 1"}],
            },
        ],
    }
    t = Ticket.model_validate(ticket(stage="build", raw={"codebuild": build, "k8s": None}))
    text = digest(t, [])
    assert (
        "buildStatus=FAILED" in text
        and "- BUILD FAILED: exit status 1" in text
        and "INSTALL" not in text
    )


def test_local_model_settings_turn_thinking_off_for_tool_calls(settings: Settings) -> None:
    models = models_from_settings(settings)
    assert models is not None
    assert isinstance(models.local, OpenAIChatModel)
    assert models.local.settings == {
        "max_tokens": 2048,
        "extra_body": {"chat_template_kwargs": {"enable_thinking": False}},
    }
    # 추론 API가 없으면 로컬 모델이 생각 모드로 계획한다.
    assert isinstance(models.planner, OpenAIChatModel)
    assert models.planner.settings == {
        "max_tokens": 4096,
        "extra_body": {"chat_template_kwargs": {"enable_thinking": True}},
    }
    assert models.planner.model_name == "Qwen/Qwen3-8B-AWQ"


def test_planner_api_falls_back_to_the_thinking_local_model(settings: Settings) -> None:
    settings = settings.model_copy(
        update={
            "planner_model_url": AnyHttpUrl("https://api.example.com/v1"),
            "planner_model_name": "reasoner",
        }
    )
    models = models_from_settings(settings)
    assert models is not None
    assert isinstance(models.planner, FallbackModel)
    first, second = models.planner.models
    assert isinstance(first, RedactingModel) and first.wrapped.model_name == "reasoner"
    assert isinstance(second, OpenAIChatModel) and second.settings is not None
    assert second.settings.get("max_tokens") == 4096
