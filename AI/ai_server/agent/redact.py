"""외부 추론 모델 API로 보내기 직전의 가림 필터 (FR-102).

플랫폼 서버가 티켓에 거는 외부 전송 필터와 별개로 한 번 더 건다. 도구 결과(로그 · 레포 파일)도
모델에 들어가기 때문이다. 로컬 모델은 클러스터 안이라 걸지 않는다.
"""

import dataclasses
import re
from typing import Any

from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.settings import ModelSettings

MASK = "[REDACTED]"

# 이름이 비밀값 같은 키의 값: `PASSWORD=...`, `"apiKey": "..."`, `DATABASE_URL: ...`
_SECRET_NAME = (
    r"[A-Za-z0-9_.-]*(?:passw(?:or)?d|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key"
    r"|credential|auth|database_url|dsn)[A-Za-z0-9_.-]*"
)
_SECRET_KEY = re.compile(rf"^{_SECRET_NAME}$", re.IGNORECASE)
_PATTERNS = [
    # Authorization 헤더. 아래 키=값보다 먼저 해야 `Authorization: Bearer x`의 x가 가려진다.
    re.compile(r"(?P<keep>\b(?:Bearer|Basic|Token)\s+)(?P<secret>[A-Za-z0-9._~+/=-]{8,})"),
    # 키 = 값 / 키: 값 (따옴표 있어도 됨). 키는 남기고 값만 가린다.
    # 이미 가린 값, 헤더의 방식 이름, JSON 배열 · 객체의 시작은 값으로 보지 않는다.
    re.compile(
        rf"""(?P<keep>["']?{_SECRET_NAME}["']?\s*[:=]\s*["']?)"""
        rf"""(?!\[REDACTED\]|(?:Bearer|Basic|Token)\s|[\[{{])(?P<secret>[^\s"',;}}]+)""",
        re.IGNORECASE,
    ),
    # 주소 안의 사용자:비밀번호@
    re.compile(r"(?P<keep>[a-z][a-z0-9+.-]*://[^\s:/@]+:)(?P<secret>[^\s@/]+)(?=@)", re.IGNORECASE),
    # 이름 없이 나와도 모양으로 알 수 있는 토큰
    re.compile(
        r"(?P<keep>)(?P<secret>"
        r"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}"  # GitHub
        r"|sk-[A-Za-z0-9_-]{16,}"  # OpenAI 계열
        r"|(?:AKIA|ASIA)[0-9A-Z]{16}"  # AWS access key id
        r"|xox[abprs]-[A-Za-z0-9-]{10,}"  # Slack
        r"|sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}"  # Supabase
        r"|gw_[A-Za-z0-9_-]{8,}"  # 게이트웨이 토큰
        r"|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"  # JWT
        r"|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"
        r")"
    ),
]


def redact(text: str) -> str:
    for pattern in _PATTERNS:
        text = pattern.sub(lambda m: m.group("keep") + MASK, text)
    return text


def redact_value(value: Any) -> Any:
    """문자열 · dict · list 안의 문자열을 모두 가린다. 이름이 비밀값 같은 키의 문자열 값은 통째로."""
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, dict):
        return {
            k: MASK
            if isinstance(k, str) and _SECRET_KEY.match(k) and isinstance(v, str)
            else redact_value(v)
            for k, v in value.items()
        }
    if isinstance(value, list | tuple):
        return [redact_value(v) for v in value]
    return value


def _redact_part(part: Any) -> Any:
    changes = {
        name: redact_value(getattr(part, name))
        for name in ("content", "args")
        if hasattr(part, name)
    }
    return dataclasses.replace(part, **changes) if changes else part


def redact_messages(messages: list[ModelMessage]) -> list[ModelMessage]:
    out: list[ModelMessage] = []
    for message in messages:
        parts = [_redact_part(p) for p in message.parts]
        if isinstance(message, ModelRequest):
            instructions = message.instructions
            out.append(
                dataclasses.replace(
                    message,
                    parts=parts,
                    instructions=redact(instructions) if instructions else instructions,
                )
            )
        else:
            assert isinstance(message, ModelResponse)
            out.append(dataclasses.replace(message, parts=parts))
    return out


class RedactingModel(WrapperModel):
    """감싼 모델에 보내는 모든 메시지(지시문 · 티켓 · 도구 결과 · 이전 도구 인자)를 가린다."""

    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        return await self.wrapped.request(
            redact_messages(messages), model_settings, model_request_parameters
        )
