import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from ai_server.agent.memory import CaseMemory, PathCond, load_cases, select
from ai_server.agent.models import Ticket
from tests.samples import ticket

# ---- 경로 ----

DOC = {"a": {"b": [{"c": 1}, {"c": 2}, {"d": 3}], "e": "x"}, "f": [[1, 2], [3]]}


@pytest.mark.parametrize(
    ("path", "values"),
    [
        ("a.e", ["x"]),
        ("a.b[*].c", [1, 2]),
        ("a.b[1].c", [2]),
        ("a.b[2].d", [3]),
        ("a.b[3].c", []),
        ("a.b[*].z", []),
        ("a.e.z", []),
        ("a.e[*]", []),
        ("f[*][*]", [1, 2, 3]),
        ("f[1][0]", [3]),
        ("missing", []),
    ],
)
def test_select(path: str, values: list[Any]) -> None:
    assert select(DOC, path) == values


@pytest.mark.parametrize("path", ["a..b", "a.b[", "a.b[x]", "a.b[-1]", "1a", ""])
def test_select_rejects_bad_paths(path: str) -> None:
    with pytest.raises(ValueError):
        select(DOC, path)


def test_condition_needs_exactly_one_test() -> None:
    with pytest.raises(ValidationError):
        PathCond.model_validate({"path": "a.e"})
    with pytest.raises(ValidationError):
        PathCond.model_validate({"path": "a.e", "equals": "x", "regex": "x"})
    with pytest.raises(ValidationError):
        PathCond.model_validate({"path": "a.e", "regex": "("})
    with pytest.raises(ValidationError):
        PathCond.model_validate({"path": "a..e", "equals": 1})


@pytest.mark.parametrize(
    ("cond", "holds"),
    [
        ({"path": "a.e", "equals": "x"}, True),
        ({"path": "a.e", "equals": "y"}, False),
        ({"path": "a.b[*].c", "equals": 2}, True),
        ({"path": "a.b[*].c", "notEquals": 1}, True),
        ({"path": "a.b[0].c", "notEquals": 1}, False),
        ({"path": "a.missing", "notEquals": 1}, False),
        ({"path": "a.e", "regex": "^x$"}, True),
        ({"path": "a.b[*].c", "regex": "1"}, False),  # 문자열이 아닌 값에는 정규식을 대지 않는다
        ({"path": "a.missing", "equals": None}, False),
    ],
)
def test_path_condition(cond: dict[str, Any], holds: bool) -> None:
    assert PathCond.model_validate(cond).holds(DOC) is holds


# ---- 초기 case 15개 (§8 표) ----


def test_initial_cases_are_the_ones_in_the_design() -> None:
    ids = sorted(c.case_id for c in load_cases())
    assert ids == sorted(
        [
            *["B1", "B2", "B3", "B4", "B5", "P1", "P2", "P3", "R1", "R2", "R3"],
            *["A1", "A2", "A3", "A4", "V1", "V2"],
        ]
    )
    letter = {"build": "B", "prepare": "P", "render": "R", "apply": "A", "verify": "V"}
    for c in load_cases():
        assert c.case_id[0] == letter[c.stage]
        assert (c.stats.hits, c.stats.solved) == (0, 0)


def test_duplicate_case_ids_are_rejected(tmp_path: Path) -> None:
    case = json.loads(Path("ai_server/agent/cases.json").read_text())[0]
    f = tmp_path / "cases.json"
    f.write_text(json.dumps([case, case]))
    with pytest.raises(ValueError, match="duplicate"):
        load_cases(f)


def _build(*lines: str) -> dict[str, Any]:
    return {
        "stage": "build",
        "raw": {"codebuild": {"buildStatus": "FAILED"}, "k8s": None},
        "logs": {
            "from": "2026-11-10T13:02:00Z",
            "to": "2026-11-10T13:12:00Z",
            "lines": list(lines),
        },
    }


def _pod(**container: Any) -> dict[str, Any]:
    return {
        "raw": {
            "codebuild": None,
            "k8s": {
                "pod": {"status": {"containerStatuses": [container]}},
                "events": [],
                "status": None,
            },
        }
    }


def _events(*events: dict[str, str]) -> dict[str, Any]:
    return {"raw": {"codebuild": None, "k8s": {"pod": {}, "events": list(events), "status": None}}}


def _render(code: int, message: str, causes: list[dict[str, str]]) -> dict[str, Any]:
    """dry-run이 돌려준 k3s Status. 플랫폼은 Status message를 errorMessage에도 넣는다."""
    status = {
        "kind": "Status",
        "status": "Failure",
        "message": message,
        "reason": "Invalid" if code == 422 else "Forbidden",
        "details": {"causes": causes},
        "code": code,
    }
    k8s: dict[str, Any] = {"pod": None, "events": [], "status": status}
    return {"stage": "render", "errorMessage": message, "raw": {"codebuild": None, "k8s": k8s}}


def _verify(message: str) -> dict[str, Any]:
    """W6 실패 티켓(§5): 통과하지 못한 검사 하나는 errorMessage에, Pod · 이벤트는 raw.k8s에."""
    k8s: dict[str, Any] = {"pod": {"status": {"phase": "Running"}}, "events": [], "status": None}
    return {"stage": "verify", "errorMessage": message, "raw": {"codebuild": None, "k8s": k8s}}


# 각 case의 신호(§8 표)를 담은 티켓
SIGNALS: dict[str, dict[str, Any]] = {
    "B1": _build(' ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile"'),
    "B2": _build('error vite@7.0.0: The engine "node" is incompatible with this module.'),
    "B3": _build("Error: VITE_API_URL is not defined"),
    "B4": _build("Module not found: Error: Can't resolve './Components/Header'"),
    "B5": _build('ERROR: failed to solve: failed to compute cache key: "/dist": not found'),
    "P1": {"stage": "prepare", "errorMessage": "secret key DATABASE_URL missing"},
    "P2": {"stage": "prepare", "errorMessage": "resources total exceeds project quota"},
    "P3": {"stage": "prepare", "errorMessage": "ingressPath /api conflicts with service fe"},
    "R1": _render(
        422,
        'Deployment.apps "Web_App" is invalid: metadata.name: Invalid value: "Web_App"',
        [
            {
                "reason": "FieldValueInvalid",
                "field": "metadata.name",
                "message": 'Invalid value: "Web_App": a DNS-1035 label must consist of lower case',
            }
        ],
    ),
    "R2": _render(
        422,
        'Deployment.apps "be-b" is invalid: '
        "spec.template.spec.containers[0].ports[0].containerPort",
        [
            {
                "reason": "FieldValueInvalid",
                "field": "spec.template.spec.containers[0].ports[0].containerPort",
                "message": "Invalid value: 70000: must be between 1 and 65535, inclusive",
            }
        ],
    ),
    "R3": _render(
        403,
        'pods "be-b" is forbidden: exceeded quota: proj-quota, requested: limits.memory=2Gi',
        [],
    ),
    "A1": _events(
        {
            "reason": "Unhealthy",
            "message": 'Readiness probe failed: Get "http://10.42.0.5:8080/health": connection refused',  # noqa: E501 — 실제 오류 문장 그대로
        }
    ),
    "A2": _pod(
        state={"waiting": {"reason": "CrashLoopBackOff"}},
        lastState={"terminated": {"exitCode": 1, "reason": "Error"}},
    ),
    "A3": _pod(
        state={"waiting": {"reason": "CrashLoopBackOff"}},
        lastState={"terminated": {"exitCode": 137, "reason": "OOMKilled"}},
    ),
    "V1": _verify("fe: GET /assets/index-abc.js -> 404"),
    "V2": _verify("be: GET /api/health -> 404"),
    "A4": _events(
        {
            "reason": "FailedCreate",
            "message": 'Error creating: pods "be-b-x" is forbidden: exceeded quota: proj-quota',
        }
    ),
}


@pytest.mark.parametrize("case_id", sorted(SIGNALS))
def test_code_classification_finds_each_case(case_id: str) -> None:
    memory = CaseMemory(load_cases())
    case = memory.classify(Ticket.model_validate(ticket(**SIGNALS[case_id])))
    assert case is not None and case.case_id == case_id


def test_classification_only_looks_at_cases_of_the_ticket_stage() -> None:
    memory = CaseMemory(load_cases())
    # B4의 신호지만 apply 단계 티켓이다.
    t = ticket(stage="apply", logs=_build("Cannot find module 'x'")["logs"])
    assert memory.classify(Ticket.model_validate(t)) is None


def test_render_cases_read_the_status_not_the_error_message() -> None:
    memory = CaseMemory(load_cases())
    # 문장은 R3과 같지만 Status 원본이 다르면(422, causes 없음) R3이 아니다.
    t = ticket(**_render(422, "exceeded quota", []))
    assert memory.classify(Ticket.model_validate(t)) is None


def test_render_status_codes_matter() -> None:
    memory = CaseMemory(load_cases())
    r1 = SIGNALS["R1"]
    t = ticket(**_render(403, r1["errorMessage"], r1["raw"]["k8s"]["status"]["details"]["causes"]))
    assert memory.classify(Ticket.model_validate(t)) is None


def test_unknown_failure_is_not_classified() -> None:
    memory = CaseMemory(load_cases())
    assert memory.classify(Ticket.model_validate(ticket())) is None
    assert all(c.stats.hits == 0 for c in memory.cases)


def test_a2_is_not_matched_by_a_clean_exit() -> None:
    memory = CaseMemory(load_cases())
    t = ticket(
        **_pod(
            state={"running": {}}, lastState={"terminated": {"exitCode": 0, "reason": "Completed"}}
        )
    )
    assert memory.classify(Ticket.model_validate(t)) is None


def test_a1_needs_the_probe_message() -> None:
    memory = CaseMemory(load_cases())
    t = ticket(**_events({"reason": "Unhealthy", "message": "something else"}))
    assert memory.classify(Ticket.model_validate(t)) is None


def test_hits_and_solved_count_per_case() -> None:
    memory = CaseMemory(load_cases())
    t = Ticket.model_validate(ticket(**SIGNALS["A1"]))
    memory.classify(t)
    memory.classify(t)
    memory.record_solved("A1")
    memory.record_solved("Z9")  # 모르는 case는 무시
    a1 = memory.get("A1")
    assert a1 is not None and (a1.stats.hits, a1.stats.solved) == (2, 1)
    assert sum(c.stats.solved for c in memory.cases) == 1


@pytest.mark.parametrize(
    ("message", "case_id"),
    [
        ("fe: GET /assets/index-abc.js -> 404", "V1"),
        ("fe: GET /static/app.css -> 404", "V1"),
        ("fe: GET /favicon.svg -> 404", "V1"),
        ("be: GET /api/health -> 404", "V2"),
        ("be: GET /healthz -> 404", "V2"),
        ("be: GET /api/v1/ready -> 404", "V2"),
        ("be: GET /api/app.js -> 404", "V1"),  # 파일 404가 먼저다
        ("fe: GET / -> 404", None),  # 페이지 자체의 404는 V1 · V2가 아니다
        ("fe: GET /assets/index.js -> 500", None),
        ("be: GET /api/health -> 502", None),
        ("be: GET /api/health -> error: connection refused", None),
        ("be: not ready (readiness probe failed)", None),
        ("be: no endpoints", None),
    ],
)
def test_verify_cases_read_the_failed_check_in_the_error_message(
    message: str, case_id: str | None
) -> None:
    memory = CaseMemory(load_cases())
    case = memory.classify(Ticket.model_validate(ticket(**_verify(message))))
    assert (case.case_id if case else None) == case_id


def test_verify_cases_only_match_verify_tickets() -> None:
    memory = CaseMemory(load_cases())
    t = ticket(**SIGNALS["A1"])
    assert memory.classify(Ticket.model_validate(t)) is not None
    assert all(c.stage == "verify" for c in memory.cases if c.case_id.startswith("V"))
