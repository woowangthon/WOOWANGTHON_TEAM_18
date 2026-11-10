"""오류 응답 `{ "error": { "code", "message", "fields"? } }` (SRS §2.4, api.md INVALID_SPEC)."""

from typing import Any

from fastapi.responses import JSONResponse
from pydantic import ValidationError

MAX_FIELDS = 20

# pydantic 오류 type → api.md의 칸 오류 code
_FIELD_CODES = {
    "missing": "REQUIRED",
    "extra_forbidden": "UNKNOWN_KEY",
    "string_pattern_mismatch": "INVALID_VALUE",
    "literal_error": "INVALID_VALUE",
    "string_too_short": "INVALID_VALUE",
    "datetime_from_date_parsing": "INVALID_VALUE",
    "timezone_aware": "INVALID_VALUE",
    "too_long": "OUT_OF_RANGE",
}


def error(status: int, code: str, message: str, **extra: Any) -> JSONResponse:
    return JSONResponse(
        status_code=status, content={"error": {"code": code, "message": message, **extra}}
    )


def field_path(loc: tuple[int | str, ...]) -> str:
    """('ticket', 'raw', 'k8s', 'events', 0) → 'ticket.raw.k8s.events[0]'"""
    out = ""
    for part in loc:
        out += f"[{part}]" if isinstance(part, int) else (f".{part}" if out else part)
    return out


def invalid_fields(e: ValidationError) -> list[dict[str, str]]:
    """칸마다 코드 하나, 최대 20칸 (api.md `INVALID_SPEC`과 같은 모양)."""
    # pydantic은 칸마다 오류 하나를 낸다(`X | None` 칸도 하나로 접는다).
    return [
        {"path": field_path(err["loc"]), "code": _FIELD_CODES.get(err["type"], "INVALID_TYPE")}
        for err in e.errors()[:MAX_FIELDS]
    ]
