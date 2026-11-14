"""플랫폼 서버 MCP 게이트웨이 연결 (api.md "MCP 게이트웨이 — 도구")."""

import json
import logging
from typing import Any

from pydantic_ai import ModelRetry
from pydantic_ai.mcp import MCPToolset

from ai_server.agent.budget import trim_tool_result
from ai_server.agent.models import Action, AgentResult
from ai_server.agent.trace import args_shape, clean, fields_shape, trace

log = logging.getLogger(__name__)

# 게이트웨이는 run_* · wait_target_ready를 파이프라인이 끝날 때까지(최대 30분) 붙잡는다.
CALL_TIMEOUT_SECONDS = 35 * 60
RESULT_TEXT_LIMIT = 500

# 이 거절이 오면 더 할 수 있는 것이 없어 에이전트 실행을 멈춘다. 나머지 거절은 모델에게 돌려줘
# 인자를 고치게 한다(INVALID_ARGUMENT · PATCH_FORBIDDEN · INVALID_SPEC · OVERRIDE_LIMIT ·
# EDIT_FORBIDDEN · NOT_VERIFIED · BOT_UNAVAILABLE · REPEATED_CALL). BOT_UNAVAILABLE는 멈추지 않는다:
# 봇 계정을 못 쓰더라도 모델이 needs_user로 고칠 파일 · 값을 안내할 수 있다.
STOP_CODES = frozenset({"TOOL_LIMIT", "TIME_LIMIT", "LIVE_SLOT_PROTECTED", "TICKET_CLOSED"})
SUBMIT_TOOL = "submit_result"


class GatewayStop(Exception):
    """게이트웨이가 실행을 더 받지 않는다. 에이전트 실행을 끝낸다."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


class GatewayRejected(Exception):
    """`submit_result`가 거절됨."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"submit_result rejected {code}: {message}")
        self.code = code


class GatewayUnreachable(Exception):
    """게이트웨이에 연결하지 못했거나 호출 중 전송이 끊김(시간 초과 포함). 거절과 다르다."""


def _short(value: Any) -> str:
    text = json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= RESULT_TEXT_LIMIT else text[:RESULT_TEXT_LIMIT] + "…"


class GatewayToolset(MCPToolset[Any]):
    """게이트웨이 도구. 거절 코드를 원본 그대로 보고, 실제로 한 호출을 `actions`에 남긴다.

    PydanticAI 기본 동작은 거절(`isError`)을 문자열로 바꿔 모델에게 다시 시키므로,
    멈춰야 하는 거절(`STOP_CODES`)을 가를 수 없다.
    """

    def __init__(self, client: Any, **kwargs: Any) -> None:
        super().__init__(client, max_retries=3, **kwargs)
        self.actions: list[Action] = []
        # 추적 로그(`trace ticket=…`)에 붙일 티켓 id. 실행기가 티켓을 받은 뒤 채운다.
        self.trace_id = "-"

    async def __aenter__(self) -> "GatewayToolset":
        try:
            await super().__aenter__()
        except Exception as e:
            raise GatewayUnreachable(f"connect failed: {e!r}") from e
        return self

    async def __aexit__(self, *exc_info: Any) -> bool | None:
        # 끊긴 연결을 닫다 난 오류가 원래 예외(전송 오류 · 거절)를 가리지 않게 한다.
        try:
            return await super().__aexit__(*exc_info)
        except Exception as e:
            log.warning("gateway close failed: %r", e)
            return None

    async def _raw_call(self, name: str, args: dict[str, Any]) -> Any:
        return await self.client.call_tool(name=name, arguments=args, raise_on_error=False)

    async def _call(self, name: str, args: dict[str, Any]) -> Any:
        try:
            return await self._raw_call(name, args)
        except Exception as e:
            trace(self.trace_id, f"tool={clean(name)} transport_error={type(e).__name__}")
            raise GatewayUnreachable(f"{name} failed in transport: {e!r}") from e

    async def direct_call_tool(
        self,
        name: str,
        args: dict[str, Any],
        *,
        metadata: dict[str, Any] | None = None,
        use_task: bool = False,
    ) -> Any:
        result = await self._call(name, args)
        content = result.structured_content
        if result.is_error:
            code = str((content or {}).get("code", "UNKNOWN"))
            message = str((content or {}).get("message", ""))
            # 칸별 오류(경로 · 코드). INVALID_SPEC은 메시지가 "see fields"뿐이라
            # 이것이 없으면 모델이 무엇이 틀렸는지 모른 채 같은 패치를 되풀이한다
            # (2026-11-14 리허설: 포트를 문자열로 네 번).
            fields = fields_shape((content or {}).get("fields"))
            # 칸별 오류를 앞에 둔다. 재계획 지시문이 기록을 200자에서 자르면
            # 뒤의 일반 메시지가 먼저 잘린다.
            detail = message if fields == "-" else f"fields {fields}; {message}"
            self.actions.append(
                Action(tool=name, args=args, ok=False, result=f"rejected {code}: {detail}")
            )
            # 추적 로그에는 거절 메시지를 싣지 않는다(값을 되풀이할 수 있다). 코드와 칸별 오류만.
            trace(
                self.trace_id,
                f"tool={clean(name)} rejected={clean(code)} fields={fields} "
                f"args={args_shape(args)}",
            )
            if code in STOP_CODES:
                raise GatewayStop(code, message)
            raise ModelRetry(f"gateway rejected {name}: {code}: {detail}")
        ok = content.get("ok", True) if isinstance(content, dict) else True
        self.actions.append(Action(tool=name, args=args, ok=bool(ok), result=_short(content)))
        trace(self.trace_id, f"tool={clean(name)} ok={bool(ok)} args={args_shape(args)}")
        # 모델에는 예산 안으로 줄인 결과를 준다(로그 발췌, 큰 원본은 필요한 칸만).
        return trim_tool_result(content)

    async def submit(self, result: AgentResult) -> None:
        reply = await self._call(SUBMIT_TOOL, {"result": result.to_wire()})
        if reply.is_error:
            content = reply.structured_content or {}
            raise GatewayRejected(
                str(content.get("code", "UNKNOWN")), str(content.get("message", ""))
            )


def connect_gateway(url: str, token: str) -> GatewayToolset:
    """티켓의 게이트웨이 토큰을 Bearer로 붙인다. 주소는 env(`GATEWAY_URL`)로만 받는다."""
    return GatewayToolset(url, id="gateway", auth=token, read_timeout=CALL_TIMEOUT_SECONDS)
