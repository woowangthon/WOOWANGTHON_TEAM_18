"""추적 로그(`trace ticket=<id>`): 무엇이 찍히는지, 그리고 값이 절대 찍히지 않는지."""

import logging
from typing import Any

import pytest

from ai_server.agent import trace
from tests.fake_gateway import FakeGateway, reject
from tests.samples import SHA
from tests.scripted import Script, call, final
from tests.test_agent_loop import PORT_PATCH, make_run, solve
from tests.test_memory import SIGNALS

SECRET_VALUE = "hunter2-sk-live-9f8e7d"
SECRET_ENV_PATCH = [
    {"op": "add", "path": "/spec/services/0/env/DB_PASSWORD", "value": SECRET_VALUE},
    {"op": "replace", "path": "/spec/services/0/runtime/port", "value": 3000},
    {"op": "replace", "path": "/spec/services/0/healthPath", "value": "/healthz"},
    {"op": "add", "path": "/spec/services/0/env", "value": {"TOKEN": SECRET_VALUE}},
    {"op": "remove", "path": "/spec/services/0/env/OLD"},
]


@pytest.fixture
def trace_log(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.INFO, logger=trace.log.name)
    return caplog


def lines(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.name == trace.log.name]


# ---- 모양 만들기: 값은 타입만 ----


def test_patch_shape_names_each_op_path_and_value_type_but_never_the_value() -> None:
    shape = trace.patch_shape(SECRET_ENV_PATCH)
    assert "add /spec/services/0/env/DB_PASSWORD str" in shape
    assert "replace /spec/services/0/runtime/port int" in shape
    assert "replace /spec/services/0/healthPath str" in shape
    assert "add /spec/services/0/env obj" in shape
    assert "remove /spec/services/0/env/OLD -" in shape
    assert SECRET_VALUE not in shape and "/healthz" not in shape.replace("healthPath", "")


@pytest.mark.parametrize(
    ("value", "kind"),
    [
        (True, "bool"),
        (3, "int"),
        (1.5, "float"),
        ("x", "str"),
        ([1], "list"),
        ({}, "obj"),
        (None, "null"),
    ],
)
def test_value_types(value: Any, kind: str) -> None:
    assert trace.value_type(value) == kind


def test_other_args_are_reported_by_name_only() -> None:
    shape = trace.args_shape(
        {"service": "be", "buildOverrides": {"cache": False}, "path": "src/.env", "specPatch": []}
    )
    assert shape == "buildOverrides path service specPatch=[]"


@pytest.mark.parametrize(
    "bad", ["text", 7, None, [1, "a", None, ["x"]], [{"op": "boom", "path": 5, "value": object()}]]
)
def test_odd_model_input_never_raises_and_never_echoes_it(bad: Any) -> None:
    out = trace.args_shape({"specPatch": bad})
    assert "specPatch=" in out and "boom" not in out


def test_model_text_is_made_safe_for_one_line_and_cut() -> None:
    shape = trace.patch_shape(
        [{"op": "add", "path": "/a\nINFO fake line " + "x" * 500, "value": 1}]
    )
    assert "\n" not in shape and len(shape) < 400


def test_long_patch_is_cut() -> None:
    shape = trace.patch_shape([{"op": "add", "path": f"/p{i}", "value": 1} for i in range(100)])
    assert "+70 more" in shape


def test_fields_show_path_and_code_only() -> None:
    fields = [
        {"path": "services[0].runtime.port", "code": "WRONG_TYPE", "message": SECRET_VALUE},
        {"path": "services[0].env", "code": "REQUIRED"},
        "not a dict",
    ]
    out = trace.fields_shape(fields)
    assert out == "services[0].runtime.port:WRONG_TYPE,services[0].env:REQUIRED"
    assert trace.fields_shape(None) == "-" and trace.fields_shape([]) == "-"


def test_fields_past_the_limit_are_counted_not_dropped_silently() -> None:
    fields = [{"path": f"env[{i}]", "code": "REQUIRED"} for i in range(25)]
    out = trace.fields_shape(fields)
    assert out.startswith("env[0]:REQUIRED,") and "env[19]:REQUIRED" in out
    assert "env[20]" not in out and out.endswith(",+5 more")


def test_exception_shape_is_class_names_only() -> None:
    try:
        try:
            raise ValueError(SECRET_VALUE)
        except ValueError as inner:
            raise RuntimeError(SECRET_VALUE) from inner
    except RuntimeError as e:
        assert trace.exc_shape(e) == "RuntimeError cause=ValueError"
    group = BaseExceptionGroup("g", [KeyError(SECRET_VALUE), OSError()])
    assert trace.exc_shape(group) == "ExceptionGroup inner=KeyError,OSError"


# ---- 흐름에서 찍히는 줄 ----


def test_a_playbook_run_logs_classification_model_calls_and_outcome(
    trace_log: pytest.LogCaptureFixture,
) -> None:
    gw = FakeGateway()
    local = Script(
        call("run_render", specPatch=SECRET_ENV_PATCH),
        call("run_deploy", specPatch=SECRET_ENV_PATCH),
        call("run_verify"),
        final(status="verified", specPatch=PORT_PATCH, summary="고쳤습니다."),
    )
    solve(make_run(**SIGNALS["A1"]), gw, local)
    out = lines(trace_log)
    assert all(line.startswith("trace ticket=t_0013 ") for line in out)
    assert "trace ticket=t_0013 classify case=A1 method=code matched=True" in out
    assert any(
        line.startswith("trace ticket=t_0013 act model=local name=function:") for line in out
    )
    done = next(
        line for line in out if line.startswith("trace ticket=t_0013 act done model=local ")
    )
    # 측정용 수: 모델 요청 4번(도구 3 + 결과 1), 토큰과 걸린 시간
    assert " requests=4 in_tokens=" in done and " out_tokens=" in done and " seconds=" in done
    render = next(line for line in out if " tool=run_render " in line)
    assert render.endswith(
        "ok=True args=specPatch=[add /spec/services/0/env/DB_PASSWORD str; "
        "replace /spec/services/0/runtime/port int; replace /spec/services/0/healthPath str; "
        "add /spec/services/0/env obj; remove /spec/services/0/env/OLD -]"
    )
    final_line = out[-1]
    assert " outcome status=verified path=playbook actions=3 elapsed=" in final_line
    assert final_line.endswith(" exc=-")


def test_no_value_reaches_the_log_even_through_the_other_log_lines(
    trace_log: pytest.LogCaptureFixture,
) -> None:
    gw = FakeGateway()
    local = Script(
        call("run_render", specPatch=SECRET_ENV_PATCH),
        call("run_verify"),
        final(status="verified", specPatch=PORT_PATCH, summary="고쳤습니다."),
    )
    solve(make_run(**SIGNALS["A1"]), gw, local)
    assert SECRET_VALUE not in trace_log.text
    assert "/healthz" not in "\n".join(lines(trace_log)).replace("healthPath", "")


def test_a_rejection_logs_its_code_and_field_paths_but_not_the_message_or_values(
    trace_log: pytest.LogCaptureFixture,
) -> None:
    gw = FakeGateway()
    gw.script["run_render"] = [
        {
            "__reject__": {
                "code": "INVALID_SPEC",
                "message": f"value {SECRET_VALUE} is wrong",
                "fields": [{"path": "services[0].runtime.port", "code": "WRONG_TYPE"}],
            }
        }
    ]
    local = Script(
        call("run_render", specPatch=SECRET_ENV_PATCH),
        final(status="gave_up", summary="멈춤"),
    )
    solve(make_run(**SIGNALS["A1"]), gw, local, Script(final(status="gave_up", summary="멈춤")))
    rejected = next(line for line in lines(trace_log) if " tool=run_render rejected=" in line)
    assert (
        " rejected=INVALID_SPEC fields=services[0].runtime.port:WRONG_TYPE "
        "args=specPatch=[add /spec/services/0/env/DB_PASSWORD str;"
    ) in rejected
    assert SECRET_VALUE not in trace_log.text and "is wrong" not in "\n".join(lines(trace_log))


def test_repeated_rejections_end_the_run_and_the_log_says_how(
    trace_log: pytest.LogCaptureFixture,
) -> None:
    # 개발 리허설과 같은 모양: 거절이 도구 재시도 한도를 넘어 UnexpectedModelBehavior로 끝난다.
    gw = FakeGateway()
    gw.script["run_render"] = [reject("INVALID_SPEC") for _ in range(12)]
    local = Script(*[call("run_render", specPatch=SECRET_ENV_PATCH) for _ in range(6)])
    planner = Script(*[call("run_render", specPatch=SECRET_ENV_PATCH) for _ in range(6)])
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    out = lines(trace_log)
    assert sum(" tool=run_render rejected=INVALID_SPEC " in line for line in out) >= 8
    # 로컬이 한도를 넘으면 그 사실을 남기고 추론 모델로 다시 계획한다.
    assert any(
        " act failed model=local exc=UnexpectedModelBehavior cause=ModelRetry" in line
        for line in out
    )
    assert out[-1].endswith(" exc=UnexpectedModelBehavior cause=ModelRetry")
    assert " outcome status=gave_up path=replan_after_playbook " in out[-1]
    assert SECRET_VALUE not in trace_log.text


def test_replan_logs_the_path_and_the_planner_model(trace_log: pytest.LogCaptureFixture) -> None:
    gw = FakeGateway()
    local = Script(final(status="gave_up", summary="모름"))
    planner = Script(final(status="gave_up", summary="모름"))
    solve(make_run(**SIGNALS["A1"]), gw, local, planner)
    out = lines(trace_log)
    assert "trace ticket=t_0013 path=replan_after_playbook (playbook gave up)" in out
    assert any(" act model=planner name=function:" in line for line in out)
    assert " outcome status=gave_up path=replan_after_playbook " in out[-1]


def test_llm_classification_is_logged_with_its_method(trace_log: pytest.LogCaptureFixture) -> None:
    gw = FakeGateway()
    local = Script(final(case_id="A1"), final(status="gave_up", summary="모름"))
    solve(make_run(), gw, local, Script(final(status="gave_up", summary="모름")))
    out = lines(trace_log)
    assert "trace ticket=t_0013 classify case=none method=code matched=False" in out
    assert "trace ticket=t_0013 classify case=A1 method=llm matched=True" in out


def test_a_closed_ticket_logs_that_it_was_closed(trace_log: pytest.LogCaptureFixture) -> None:
    gw = FakeGateway()
    gw.script["run_verify"] = [reject("TICKET_CLOSED")]
    solve(make_run(**SIGNALS["A1"]), gw, Script(call("run_verify")))
    assert any(
        " outcome closed elapsed=" in line and line.endswith("exc=GatewayStop code=TICKET_CLOSED")
        for line in lines(trace_log)
    )


def test_a_transport_error_is_logged_by_class_only(trace_log: pytest.LogCaptureFixture) -> None:
    gw = FakeGateway()
    gw.broken["run_verify"] = 1
    local = Script(call("run_verify"))
    solve(make_run(**SIGNALS["A1"]), gw, local)
    out = lines(trace_log)
    assert any(line.endswith("tool=run_verify transport_error=ConnectionError") for line in out)
    assert any(line.endswith("exc=GatewayUnreachable cause=ConnectionError") for line in out)


def test_the_run_ends_the_same_way_with_or_without_the_trace_log(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def run() -> dict[str, Any]:
        gw = FakeGateway()
        local = Script(
            call("run_render", specPatch=SECRET_ENV_PATCH),
            final(status="verified", specPatch=PORT_PATCH, summary="고쳤습니다."),
        )
        solve(make_run(**SIGNALS["A1"]), gw, local)
        [result] = gw.submitted
        return result

    caplog.set_level(logging.CRITICAL, logger=trace.log.name)
    quiet = run()
    caplog.set_level(logging.INFO, logger=trace.log.name)
    loud = run()
    assert quiet == loud and quiet["commitSha"] == SHA


@pytest.mark.parametrize("path", [{"k": SECRET_VALUE}, [SECRET_VALUE], None, 5])
def test_a_path_that_is_not_a_string_is_logged_as_its_type(path: Any) -> None:
    shape = trace.patch_shape([{"op": "add", "path": path, "value": 1}])
    assert SECRET_VALUE not in shape and shape.startswith("[add <")


def test_a_value_written_into_a_path_is_not_logged() -> None:
    shape = trace.patch_shape([{"op": "add", "path": f"/spec/env/KEY={SECRET_VALUE}", "value": 1}])
    assert SECRET_VALUE not in shape and shape == "[add <str> int]"


def test_a_field_path_or_code_that_is_not_plain_text_is_not_logged() -> None:
    fields = [
        {"path": {"input": SECRET_VALUE}, "code": [SECRET_VALUE]},
        {"path": f"env.KEY={SECRET_VALUE}", "code": "WRONG_TYPE"},
    ]
    out = trace.fields_shape(fields)
    assert SECRET_VALUE not in out and out == "<obj>:<list>,<str>:WRONG_TYPE"


def test_an_argument_key_that_is_not_a_plain_name_is_masked() -> None:
    assert trace.args_shape({"service": 1, SECRET_VALUE + " x": 2}) == "<key> service"
