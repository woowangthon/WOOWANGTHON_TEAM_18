import asyncio
import time
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from ai_server.agent.memory import CaseMemory
from ai_server.agent.runs import RunRegistry, TicketRun
from ai_server.config import Settings
from ai_server.main import create_app
from tests.conftest import AUTH, TOKEN, classify_only
from tests.samples import SHA, ticket_request
from tests.test_memory import SIGNALS


def wait_until(check: Callable[[], bool]) -> None:
    deadline = time.monotonic() + 2
    while not check():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.01)


class Blocking:
    """끝나지 않는 실행(에이전트가 도는 중). 시작 · 취소를 기록한다."""

    def __init__(self) -> None:
        self.started: list[str] = []
        self.cancelled: list[str] = []

    async def __call__(self, run: TicketRun, memory: CaseMemory) -> None:
        self.started.append(run.ticket.ticket_id)
        run.case_id = "A1"
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            self.cancelled.append(run.ticket.ticket_id)
            raise


@pytest.fixture
def blocking() -> Blocking:
    return Blocking()


@pytest.fixture
def busy_client(settings: Settings, blocking: Blocking) -> Iterator[TestClient]:
    with TestClient(
        create_app(settings.model_copy(update={"agent_max_runs": 2}), runner=blocking)
    ) as c:
        yield c


def runs(c: TestClient) -> RunRegistry:
    r = c.app.state.runs  # type: ignore[attr-defined]
    assert isinstance(r, RunRegistry)
    return r


def post_ticket(
    c: TestClient, body: Any = None, headers: dict[str, str] | None = None, **kw: Any
) -> Any:
    return c.post(
        "/agent/tickets",
        json=ticket_request(**kw) if body is None else body,
        headers=AUTH if headers is None else headers,
    )


def close(c: TestClient, ticket_id: str = "t_0013", reason: str = "success", **kw: Any) -> Any:
    body = {"ticketId": ticket_id, "commitSha": SHA, "reason": reason}
    return c.post(
        f"/agent/tickets/{kw.get('url_id', ticket_id)}/close",
        json=body,
        headers=kw.get("headers", AUTH),
    )


# ---- 인증 ----

BAD_AUTH = [
    {},
    {"Authorization": TOKEN},
    {"Authorization": f"Basic {TOKEN}"},
    {"Authorization": f"Bearer {TOKEN}x"},
    {"Authorization": "Bearer "},
    {"Authorization": f"Bearer  {TOKEN}"},
]


@pytest.mark.parametrize("headers", BAD_AUTH)
def test_ticket_needs_the_agent_token(client: TestClient, headers: dict[str, str]) -> None:
    res = post_ticket(client, headers=headers)
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "AUTH_REQUIRED"
    assert runs(client).get("t_0013") is None


@pytest.mark.parametrize("headers", BAD_AUTH)
def test_close_needs_the_agent_token(client: TestClient, headers: dict[str, str]) -> None:
    res = close(client, headers=headers)
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "AUTH_REQUIRED"


def test_bearer_scheme_is_case_insensitive(client: TestClient) -> None:
    assert post_ticket(client, headers={"Authorization": f"bearer {TOKEN}"}).status_code == 202


def test_error_never_echoes_the_token(client: TestClient) -> None:
    res = post_ticket(client, headers={"Authorization": f"Bearer {TOKEN}x"})
    assert TOKEN not in res.text


# ---- 접수 ----


def test_ticket_is_accepted_and_run_in_the_background(client: TestClient) -> None:
    res = post_ticket(client, **SIGNALS["A1"])
    assert res.status_code == 202
    assert res.json() == {"ticketId": "t_0013"}
    run = runs(client).get("t_0013")
    assert run is not None and run.gateway.token == "gw_abc"
    wait_until(lambda: not run.running)
    assert run.case_id == "A1"
    a1 = runs(client).memory.get("A1")
    assert a1 is not None and a1.stats.hits == 1


def test_resent_ticket_gets_the_same_202_without_a_new_run(
    busy_client: TestClient, blocking: Blocking
) -> None:
    assert post_ticket(busy_client).status_code == 202
    wait_until(lambda: blocking.started == ["t_0013"])
    first = runs(busy_client).get("t_0013")
    res = post_ticket(busy_client)
    assert (res.status_code, res.json()) == (202, {"ticketId": "t_0013"})
    assert runs(busy_client).get("t_0013") is first
    time.sleep(0.05)
    assert blocking.started == ["t_0013"]


def test_resent_after_close_does_not_restart(busy_client: TestClient, blocking: Blocking) -> None:
    post_ticket(busy_client)
    wait_until(lambda: blocking.started == ["t_0013"])
    close(busy_client, reason="stopped")
    assert post_ticket(busy_client).status_code == 202
    time.sleep(0.05)
    assert blocking.started == ["t_0013"]


def test_busy_when_too_many_runs(busy_client: TestClient, blocking: Blocking) -> None:
    assert post_ticket(busy_client, ticketId="t_1").status_code == 202
    assert post_ticket(busy_client, ticketId="t_2").status_code == 202
    res = post_ticket(busy_client, ticketId="t_3")
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "AGENT_BUSY"
    assert runs(busy_client).get("t_3") is None
    # 이미 받은 티켓의 재전송은 바빠도 202다.
    assert post_ticket(busy_client, ticketId="t_1").status_code == 202
    # 하나가 끝나면 다시 받는다.
    close(busy_client, "t_1", reason="stopped")
    wait_until(lambda: "t_1" in blocking.cancelled)
    assert post_ticket(busy_client, ticketId="t_3").status_code == 202


def test_finished_runs_do_not_count_as_busy(settings: Settings) -> None:
    settings = settings.model_copy(update={"agent_max_runs": 1})
    with TestClient(create_app(settings, runner=classify_only)) as c:
        assert post_ticket(c, ticketId="t_1").status_code == 202
        wait_until(lambda: not runs(c).busy())
        assert post_ticket(c, ticketId="t_2").status_code == 202


def test_runner_crash_is_logged_not_turned_into_a_result(
    settings: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    async def crash(run: TicketRun, memory: CaseMemory) -> None:
        raise RuntimeError("boom")

    with TestClient(create_app(settings, runner=crash)) as c:
        assert post_ticket(c).status_code == 202
        run = runs(c).get("t_0013")
        assert run is not None
        wait_until(lambda: not run.running)
        assert "ticket t_0013 run failed" in caplog.text
        assert run.case_id is None and not run.closed


@pytest.mark.parametrize("body", ["not json", "[1]", '"x"', "null"])
def test_body_must_be_a_json_object(client: TestClient, body: str) -> None:
    res = client.post(
        "/agent/tickets", content=body, headers={**AUTH, "Content-Type": "application/json"}
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "BAD_REQUEST"


def test_invalid_ticket_lists_fields(client: TestClient) -> None:
    body = ticket_request(ticketId="", stage="switch", commitSha="abc", extra=1)
    body["ticket"]["logs"]["to"] = "yesterday"
    del body["ticket"]["errorMessage"]
    body["ticket"]["raw"]["k8s"]["events"] = ["not an object"]
    body["gateway"]["expiresAt"] = "2026-11-10T13:27:00"
    res = post_ticket(client, body)
    assert res.status_code == 400
    err = res.json()["error"]
    assert err["code"] == "INVALID_TICKET"
    assert {f["path"]: f["code"] for f in err["fields"]} == {
        "ticket.ticketId": "INVALID_VALUE",
        "ticket.commitSha": "INVALID_VALUE",
        "ticket.logs.to": "INVALID_VALUE",
        "ticket.stage": "INVALID_VALUE",
        "ticket.errorMessage": "REQUIRED",
        "ticket.raw.k8s.events[0]": "INVALID_TYPE",
        "ticket.extra": "UNKNOWN_KEY",
        "gateway.expiresAt": "INVALID_VALUE",
    }
    assert err["message"] == "ticket has invalid fields (first: ticket.ticketId)"
    assert runs(client).get("t_0013") is None


def test_invalid_ticket_reports_at_most_20_fields(client: TestClient) -> None:
    body = ticket_request()
    body["ticket"]["logs"]["lines"] = list(range(30))
    res = post_ticket(client, body)
    assert res.status_code == 400
    fields = res.json()["error"]["fields"]
    assert len(fields) == 20
    assert fields[0] == {"path": "ticket.logs.lines[0]", "code": "INVALID_TYPE"}


def test_raw_that_does_not_fit_the_stage_names_the_fields(client: TestClient) -> None:
    res = post_ticket(client, stage="build")  # 표본의 raw는 apply 모양이다
    err = res.json()["error"]
    assert (res.status_code, err["code"]) == (400, "INVALID_TICKET")
    assert err["fields"] == [
        {"path": "ticket.raw.codebuild", "code": "REQUIRED"},
        {"path": "ticket.raw.k8s", "code": "MUST_BE_NULL"},
    ]
    assert err["message"] == "ticket has invalid fields (first: ticket.raw.codebuild)"


def test_too_many_log_lines_is_out_of_range(client: TestClient) -> None:
    body = ticket_request()
    body["ticket"]["logs"]["lines"] = ["x"] * 201
    fields = post_ticket(client, body).json()["error"]["fields"]
    assert fields == [{"path": "ticket.logs.lines", "code": "OUT_OF_RANGE"}]


def test_null_where_an_object_is_required_is_reported_once(client: TestClient) -> None:
    body = ticket_request()
    body["ticket"]["raw"]["k8s"] = {"pod": None, "events": None, "status": None}
    fields = post_ticket(client, body).json()["error"]["fields"]
    assert fields == [{"path": "ticket.raw.k8s.events", "code": "INVALID_TYPE"}]


# ---- 종료 알림 ----


def test_close_success_counts_solved_and_stops_the_run(
    busy_client: TestClient, blocking: Blocking
) -> None:
    post_ticket(busy_client)
    wait_until(lambda: blocking.started == ["t_0013"])
    res = close(busy_client, reason="success")
    assert res.status_code == 204 and res.content == b""
    wait_until(lambda: blocking.cancelled == ["t_0013"])
    a1 = runs(busy_client).memory.get("A1")
    assert a1 is not None and a1.stats.solved == 1
    # 같은 알림의 재전송은 두 번 세지 않는다.
    assert close(busy_client, reason="success").status_code == 204
    assert a1.stats.solved == 1


@pytest.mark.parametrize("reason", ["superseded", "stopped"])
def test_close_without_success_does_not_count(
    busy_client: TestClient, blocking: Blocking, reason: str
) -> None:
    post_ticket(busy_client)
    wait_until(lambda: blocking.started == ["t_0013"])
    assert close(busy_client, reason=reason).status_code == 204
    wait_until(lambda: blocking.cancelled == ["t_0013"])
    run = runs(busy_client).get("t_0013")
    assert run is not None and run.closed
    assert sum(c.stats.solved for c in runs(busy_client).memory.cases) == 0


def test_close_success_without_a_case_counts_nothing(client: TestClient) -> None:
    post_ticket(client)  # 분류되지 않는 티켓
    run = runs(client).get("t_0013")
    assert run is not None
    wait_until(lambda: not run.running)
    assert close(client, reason="success").status_code == 204
    assert sum(c.stats.solved for c in runs(client).memory.cases) == 0


def test_close_unknown_ticket_is_204(client: TestClient) -> None:
    assert close(client, "t_9999").status_code == 204


@pytest.mark.parametrize(
    "body",
    [
        {"ticketId": "t_0013", "commitSha": SHA, "reason": "done"},
        {"ticketId": "t_0013", "commitSha": "abc", "reason": "success"},
        {"ticketId": "t_0013", "reason": "success"},
        {"ticketId": "t_0013", "commitSha": SHA, "reason": "success", "x": 1},
    ],
)
def test_invalid_close(client: TestClient, body: dict[str, Any]) -> None:
    res = client.post("/agent/tickets/t_0013/close", json=body, headers=AUTH)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_CLOSE"
    assert res.json()["error"]["fields"]


def test_close_body_must_match_the_url(busy_client: TestClient, blocking: Blocking) -> None:
    post_ticket(busy_client)
    wait_until(lambda: blocking.started == ["t_0013"])
    res = close(busy_client, "t_0013", url_id="t_other")
    assert res.status_code == 400
    assert res.json()["error"] == {
        "code": "INVALID_CLOSE",
        "message": "ticketId differs from the URL",
        "fields": [{"path": "ticketId", "code": "MISMATCH"}],
    }
    run = runs(busy_client).get("t_0013")
    assert run is not None and not run.closed


def test_close_body_must_be_a_json_object(client: TestClient) -> None:
    res = client.post(
        "/agent/tickets/t_1/close",
        content="[]",
        headers={**AUTH, "Content-Type": "application/json"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "BAD_REQUEST"
