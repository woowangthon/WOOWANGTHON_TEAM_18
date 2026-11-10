from ai_server.agent.gateway import CALL_TIMEOUT_SECONDS, connect_gateway
from ai_server.agent.models import AgentResult
from tests.samples import result


def test_connection_uses_the_ticket_token_and_the_configured_address() -> None:
    gw = connect_gateway("http://platform:4001/mcp", "gw_abc")
    transport = gw.client.transport
    assert type(transport).__name__ == "StreamableHttpTransport"
    assert transport.url == "http://platform:4001/mcp"  # type: ignore[attr-defined]
    assert transport.auth.token.get_secret_value() == "gw_abc"  # type: ignore[attr-defined]


def test_calls_may_wait_35_minutes() -> None:
    # 게이트웨이는 run_* · wait_target_ready를 최대 30분 붙잡는다(api.md).
    assert CALL_TIMEOUT_SECONDS == 2100
    gw = connect_gateway("http://platform:4001/mcp", "gw_abc")
    assert gw._client_options is not None and gw._client_options["read_timeout"] == 2100


def test_submitted_json_keeps_case_id_and_drops_empty_fields() -> None:
    r = AgentResult.model_validate(
        result(classification={"method": "llm", "caseId": None, "path": "plan"})
    )
    wire = r.to_wire()
    assert wire["classification"] == {"method": "llm", "caseId": None, "path": "plan"}
    assert set(wire) == {
        "ticketId",
        "commitSha",
        "status",
        "classification",
        "actions",
        "evidence",
        "summary",
    }

    def nulls(v: object, at: str = "") -> list[str]:
        if isinstance(v, dict):
            return [p for k, x in v.items() for p in nulls(x, f"{at}.{k}")]
        if isinstance(v, list):
            return [p for i, x in enumerate(v) for p in nulls(x, f"{at}[{i}]")]
        return [at] if v is None else []

    assert nulls(wire) == [".classification.caseId"]
