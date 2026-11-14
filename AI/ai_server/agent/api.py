"""플랫폼 서버 → AI 서버: 티켓 접수와 종료 알림 (api.md "AI 에이전트")."""

import hmac
import json
from typing import Any

from fastapi import APIRouter, Request, Response
from pydantic import ValidationError

from ai_server.agent.incident import IncidentRequest, Judges, judge
from ai_server.agent.models import CloseNotice, TicketRequest
from ai_server.agent.runs import RunRegistry
from ai_server.config import Settings
from ai_server.errors import error, invalid_fields


def _authorized(request: Request, settings: Settings) -> bool:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    expected = settings.agent_api_token.get_secret_value()
    # 길이 · 내용이 드러나지 않게 상수 시간으로 비교한다.
    return scheme.lower() == "bearer" and hmac.compare_digest(token.encode(), expected.encode())


async def _json_object(request: Request) -> dict[str, Any] | None:
    try:
        body = json.loads(await request.body())
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


def _invalid(code: str, what: str, e: ValidationError) -> Response:
    fields = invalid_fields(e)
    return error(
        400, code, f"{what} has invalid fields (first: {fields[0]['path']})", fields=fields
    )


_AUTH_REQUIRED = (401, "AUTH_REQUIRED", "missing or wrong Authorization bearer token")
_BAD_JSON = (400, "BAD_REQUEST", "body must be a JSON object")


def build_router(settings: Settings, runs: RunRegistry, judges: Judges) -> APIRouter:
    router = APIRouter(prefix="/agent")

    @router.post("/tickets", status_code=202)
    async def receive_ticket(request: Request) -> Any:
        if not _authorized(request, settings):
            return error(*_AUTH_REQUIRED)
        body = await _json_object(request)
        if body is None:
            return error(*_BAD_JSON)
        try:
            req = TicketRequest.model_validate(body)
        except ValidationError as e:
            return _invalid("INVALID_TICKET", "ticket", e)
        ticket_id = req.ticket.ticket_id
        # 재전송: 새로 시작하지 않고 같은 202 (끝났거나 닫힌 티켓도 같다).
        if runs.get(ticket_id) is None:
            if runs.busy():
                return error(503, "AGENT_BUSY", "too many agent runs; retry later")
            runs.start(req.ticket, req.gateway)
        return {"ticketId": ticket_id}

    @router.post("/tickets/{ticket_id}/close", status_code=204)
    async def close_ticket(ticket_id: str, request: Request) -> Response:
        if not _authorized(request, settings):
            return error(*_AUTH_REQUIRED)
        body = await _json_object(request)
        if body is None:
            return error(*_BAD_JSON)
        try:
            notice = CloseNotice.model_validate(body)
        except ValidationError as e:
            return _invalid("INVALID_CLOSE", "close notice", e)
        if notice.ticket_id != ticket_id:
            fields = [{"path": "ticketId", "code": "MISMATCH"}]
            return error(400, "INVALID_CLOSE", "ticketId differs from the URL", fields=fields)
        run = runs.get(ticket_id)
        # 모르는 ticketId도 204다(이미 끝난 티켓의 재전송).
        if run is not None:
            runs.close(run, success=notice.reason == "success")
        return Response(status_code=204)

    @router.post("/incidents")
    async def judge_incident(request: Request) -> Any:
        """운영 알림 판단(docs/design/incidents.md). 동기로 답한다: 판단만 하고 실행하지 않는다."""
        if not _authorized(request, settings):
            return error(*_AUTH_REQUIRED)
        body = await _json_object(request)
        if body is None:
            return error(*_BAD_JSON)
        try:
            req = IncidentRequest.model_validate(body)
        except ValidationError as e:
            return _invalid("INVALID_INCIDENT", "incident", e)
        judged = await judge(req, judges)
        if judged is None:
            return error(503, "MODEL_UNAVAILABLE", "no model could judge this incident")
        out, model = judged
        return {**out.model_dump(), "model": model}

    return router
