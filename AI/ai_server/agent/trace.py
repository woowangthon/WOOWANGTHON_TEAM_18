"""티켓 한 건의 추적 로그. `docker logs`에서 `trace ticket=<id>`로 찾는다.

AI 서버는 결과를 게이트웨이로 한 번 내고 끝이라, 에이전트가 무엇을 불렀고 어디서 막혔는지는
여기서 남기지 않으면 볼 길이 없다. 그래서 분류 · 모델 · 도구 호출 · 끝맺음을 한 줄씩 INFO로 남긴다.

**값은 절대 싣지 않는다.** 환경변수 값이 비밀값일 수 있어 specPatch의 값은 타입만,
그 밖의 인자는 이름만 싣는다. 티켓 로그 · 증거 원문 · 토큰도 싣지 않고, 게이트웨이 거절
메시지는 값을 되풀이할 수 있어 싣지 않는다.
모델이 만든 문자열(경로 등)은 한 줄에 들어가게 다듬고 길이를 자른다.
이 모듈의 함수는 어떤 입력에도 예외를 던지지 않는다(로그가 에이전트 동작을 바꾸면 안 된다).
"""

import logging
import re
from typing import Any

log = logging.getLogger("ai_server.agent.trace")

_TEXT_LIMIT = 120
_FIELDS_LIMIT = 20
_PATCH_LIMIT = 30
_OPS = frozenset({"add", "replace", "remove", "move", "copy", "test"})
_UNSAFE = re.compile(r"[^\w./\[\]{}:@#%+=,\-]")


def clean(value: Any) -> str:
    """모델이나 서버가 준 문자열을 로그 한 줄에 안전한 짧은 글로 바꾼다."""
    text = _UNSAFE.sub("?", str(value))
    return text if len(text) <= _TEXT_LIMIT else text[:_TEXT_LIMIT] + "…"


def value_type(value: Any) -> str:
    """값 자체는 싣지 않고 타입만 알린다."""
    if value is None:
        return "null"
    if isinstance(value, bool):  # bool은 int의 하위 타입이라 먼저 가른다.
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        return "str"
    if isinstance(value, list):
        return "list"
    if isinstance(value, dict):
        return "obj"
    return "other"


def patch_shape(patch: Any) -> str:
    """specPatch의 각 연산을 `op path 값타입`으로. 값은 싣지 않는다."""
    if not isinstance(patch, list):
        return f"<{value_type(patch)}>"
    parts: list[str] = []
    for op in patch[:_PATCH_LIMIT]:
        if not isinstance(op, dict):
            parts.append(f"<{value_type(op)}>")
            continue
        name = op.get("op")
        kind = name if isinstance(name, str) and name in _OPS else "?"
        value = value_type(op["value"]) if "value" in op else "-"
        parts.append(f"{kind} {clean(op.get('path', ''))} {value}")
    if len(patch) > _PATCH_LIMIT:
        parts.append(f"+{len(patch) - _PATCH_LIMIT} more")
    return "[" + "; ".join(parts) + "]"


def args_shape(args: Any) -> str:
    """도구 인자의 모양. specPatch만 연산별로 풀고, 나머지는 이름만 싣는다."""
    if not isinstance(args, dict):
        return f"<{value_type(args)}>"
    parts: list[str] = []
    for key in sorted(args, key=str):
        if key == "specPatch":
            parts.append(f"specPatch={patch_shape(args[key])}")
        else:
            parts.append(clean(key))
    return " ".join(parts) if parts else "-"


def fields_shape(fields: Any) -> str:
    """게이트웨이 거절의 칸별 오류를 `경로:코드`로. 메시지는 싣지 않는다."""
    if not isinstance(fields, list):
        return "-"
    parts = [
        f"{clean(f.get('path', ''))}:{clean(f.get('code', ''))}"
        for f in fields[:_FIELDS_LIMIT]
        if isinstance(f, dict)
    ]
    return ",".join(parts) if parts else "-"


def exc_shape(e: BaseException) -> str:
    """예외 클래스 이름만(메시지는 값을 되풀이할 수 있다). 원인과 묶음 안의 예외도 이름만."""
    out = type(e).__name__
    if e.__cause__ is not None:
        out += f" cause={type(e.__cause__).__name__}"
    if isinstance(e, BaseExceptionGroup):
        out += " inner=" + ",".join(type(x).__name__ for x in e.exceptions)
    return out


def trace(ticket_id: str, message: str) -> None:
    log.info("trace ticket=%s %s", clean(ticket_id), message)
