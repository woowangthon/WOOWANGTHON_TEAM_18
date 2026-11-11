"""로컬 모델 16K 컨텍스트 예산. 받은 티켓과 게이트웨이 도구 결과를 받는 쪽에서 자른다.

vLLM `--max-model-len 16384`는 입력 + 출력의 합이다. 입력은 약 10K 토큰을 목표로 한다.
토큰은 vLLM에 붙이기 전이라 글자 수로 어림한다(영문 · JSON은 3~4자가 1토큰쯤).
자른 것은 그 사실을 남겨 모델이 알게 한다.
"""

import dataclasses
import json
import re
from typing import Any

from pydantic_ai.messages import ModelMessage, ModelRequest, ToolReturnPart

from ai_server.agent.models import Ticket

LINE_CHARS = 400  # 로그 한 줄 (받을 때)
LOG_BYTES = 24_000  # 로그 전체 (받을 때, 앞에서부터 버린다)
RAW_CHARS = 6_000  # 원본 JSON 하나(Pod · builds[0] · Status)나 이벤트 목록 전체
EVENTS_MAX = 50  # 줄인 이벤트 목록에 남기는 수(최근 것)

# 로컬 모델 입력 상한의 어림(약 10K 토큰). 테스트가 이 글자 수를 넘지 않는지 본다.
LOCAL_INPUT_CHARS = 30_000

# 프롬프트에 넣는 로그 발췌
EXCERPT_LINES = 60
EXCERPT_TAIL = 20
EXCERPT_CONTEXT = 2
EXCERPT_LINE_CHARS = 200
ERROR_MARK = re.compile(
    r"error|ERR!|fail|exit code|exception|fatal|panic|denied|refused|not found|killed|cannot",
    re.IGNORECASE,
)


def _size(value: Any) -> int:
    return len(json.dumps(value, ensure_ascii=False, default=str))


def clip_line(line: str, limit: int = LINE_CHARS) -> str:
    if len(line) <= limit:
        return line
    return f"{line[:limit]}…[truncated {len(line) - limit} chars]"


def clip_log(lines: list[str]) -> tuple[list[str], list[str]]:
    """줄마다 400자, 전체 24KB. 넘으면 앞줄부터 버리고 마지막 줄들을 남긴다."""
    clipped = [clip_line(line) for line in lines]
    notes = []
    long_lines = sum(c != line for c, line in zip(clipped, lines, strict=True))
    if long_lines:
        notes.append(f"{long_lines} log lines cut to {LINE_CHARS} chars")
    total = sum(len(line.encode()) + 1 for line in clipped)
    dropped = 0
    while total > LOG_BYTES and dropped < len(clipped):
        total -= len(clipped[dropped].encode()) + 1
        dropped += 1
    if dropped:
        notes.append(f"first {dropped} log lines dropped ({LOG_BYTES // 1000}KB limit)")
    return clipped[dropped:], notes


def _clip_strings(value: Any) -> Any:
    if isinstance(value, str):
        return clip_line(value)
    if isinstance(value, dict):
        return {k: _clip_strings(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clip_strings(v) for v in value]
    return value


def _pick(obj: Any, *keys: str) -> dict[str, Any]:
    return {k: obj[k] for k in keys if isinstance(obj, dict) and k in obj}


def essential_pod(pod: dict[str, Any]) -> dict[str, Any]:
    status = pod.get("status") or {}
    containers = [
        _pick(c, "name", "ready", "restartCount", "state", "lastState")
        for c in (status.get("containerStatuses") or [])
        + (status.get("initContainerStatuses") or [])
    ]
    return {
        "metadata": _pick(pod.get("metadata") or {}, "name"),
        "status": {**_pick(status, "phase", "reason", "message"), "containerStatuses": containers},
    }


def essential_event(event: dict[str, Any]) -> dict[str, Any]:
    return {
        **_pick(event, "type", "reason", "message", "count"),
        "involvedObject": _pick(event.get("involvedObject") or {}, "kind", "name"),
    }


def essential_build(build: dict[str, Any]) -> dict[str, Any]:
    phases = [
        {
            **_pick(p, "phaseType", "phaseStatus"),
            "contexts": [_pick(c, "statusCode", "message") for c in p.get("contexts") or []],
        }
        for p in build.get("phases") or []
    ]
    return {**_pick(build, "buildStatus", "currentPhase"), "phases": phases}


def essential_status(status: dict[str, Any]) -> dict[str, Any]:
    details = status.get("details") or {}
    return {
        **_pick(status, "code", "reason", "message"),
        "details": {"causes": details.get("causes") or []},
    }


def _shrink(name: str, value: Any, essential: Any, notes: list[str]) -> Any:
    """크면 필요한 칸만 남기고, 그래도 크면 긴 문자열을 자른다."""
    if value is None or _size(value) <= RAW_CHARS:
        return value
    if isinstance(value, list):
        reduced: Any = [essential(v) for v in value if isinstance(v, dict)][-EVENTS_MAX:]
    else:
        reduced = essential(value)
    notes.append(f"{name} reduced to its key fields ({RAW_CHARS} chars limit)")
    return _clip_strings(reduced)


def trim_ticket(ticket: Ticket) -> tuple[Ticket, list[str]]:
    """받은 티켓을 예산 안으로. 코드 분류(①)는 자르기 전 원본으로 한다."""
    notes: list[str] = []
    lines, log_notes = clip_log(ticket.logs.lines)
    notes += log_notes
    raw = ticket.raw
    codebuild = _shrink("raw.codebuild", raw.codebuild, essential_build, notes)
    k8s = raw.k8s
    if k8s is not None:
        k8s = k8s.model_copy(
            update={
                "pod": _shrink("raw.k8s.pod", k8s.pod, essential_pod, notes),
                "events": _shrink("raw.k8s.events", k8s.events, essential_event, notes),
                "status": _shrink("raw.k8s.status", k8s.status, essential_status, notes),
            }
        )
    trimmed = ticket.model_copy(
        update={
            "error_message": clip_line(ticket.error_message),
            "logs": ticket.logs.model_copy(update={"lines": lines}),
            "raw": raw.model_copy(update={"codebuild": codebuild, "k8s": k8s}),
        }
    )
    return trimmed, notes


def excerpt(lines: list[str]) -> list[str]:
    """오류 표시 줄의 앞뒤 몇 줄과 마지막 20줄, 합쳐 최대 60줄. 건너뛴 곳은 `…`."""
    n = len(lines)
    keep = set(range(max(0, n - EXCERPT_TAIL), n))
    for i in range(n - 1, -1, -1):
        if len(keep) >= EXCERPT_LINES:
            break
        if ERROR_MARK.search(lines[i]):
            around = range(max(0, i - EXCERPT_CONTEXT), min(n, i + EXCERPT_CONTEXT + 1))
            keep.update(list(around)[: EXCERPT_LINES - len(keep)])
    out: list[str] = []
    previous = -1
    for i in sorted(keep):
        if i != previous + 1:
            out.append("…")
        out.append(clip_line(lines[i], EXCERPT_LINE_CHARS))
        previous = i
    return out


EVENTS_SHOWN = 10
EVENT_MESSAGE_CHARS = 300


def latest_events(events: list[Any]) -> list[dict[str, Any]]:
    """reason · message만, 같은 것은 한 번, 최근 10개."""
    seen: list[dict[str, Any]] = []
    for e in reversed(events):
        if not isinstance(e, dict):
            continue
        item = {
            "reason": e.get("reason"),
            "message": clip_line(str(e.get("message")), EVENT_MESSAGE_CHARS),
        }
        if item not in seen:
            seen.append(item)
        if len(seen) == EVENTS_SHOWN:
            break
    return list(reversed(seen))


_LOG_FIELDS = ("lines", "logTail")
_RAW_FIELDS = {
    "pods": essential_pod,
    "build": essential_build,
    "status": essential_status,
}


def trim_tool_result(content: Any) -> Any:
    """게이트웨이 도구 결과를 모델에 줄 크기로. 로그는 발췌, 큰 원본은 필요한 칸만."""
    if not isinstance(content, dict):
        return content
    notes: list[str] = []
    out = dict(content)
    for key in _LOG_FIELDS:
        value = out.get(key)
        if isinstance(value, list) and all(isinstance(v, str) for v in value):
            short = excerpt(clip_log(value)[0])
            if short != value:
                notes.append(f"{key}: showing {sum(s != '…' for s in short)} of {len(value)} lines")
            out[key] = short
    if isinstance(out.get("events"), list):
        events = latest_events(out["events"])
        if events != out["events"]:
            notes.append(f"events: showing {len(events)} latest distinct of {len(out['events'])}")
        out["events"] = events
    for key, essential in _RAW_FIELDS.items():
        if key in out:
            out[key] = _shrink(key, out[key], essential, notes)
    if notes:
        out["_truncated"] = notes
    return out


SUMMARY_CHARS = 300


def one_line(tool: str, content: Any) -> str:
    """지난 도구 결과의 한 줄 요약: 도구 · ok · 짧은 값 칸과 목록의 길이."""
    if not isinstance(content, dict):
        return clip_line(str(content), SUMMARY_CHARS)
    fields = []
    for key, value in content.items():
        if key == "_truncated":
            continue
        if isinstance(value, list | dict):
            fields.append(f"{key}=[{len(value)}]")
        else:
            fields.append(f"{key}={clip_line(str(value), 80)}")
    return clip_line(f"{tool} (earlier result, summarized): " + " ".join(fields), SUMMARY_CHARS)


def compact_history(messages: list[ModelMessage]) -> list[ModelMessage]:
    """가장 최근 도구 결과만 전체로 두고, 그 이전 결과는 한 줄 요약으로 바꾼다."""
    last = max(
        (
            i
            for i, m in enumerate(messages)
            if isinstance(m, ModelRequest) and any(isinstance(p, ToolReturnPart) for p in m.parts)
        ),
        default=-1,
    )
    out: list[ModelMessage] = []
    for i, m in enumerate(messages):
        if i < last and isinstance(m, ModelRequest):
            parts = [
                dataclasses.replace(p, content=one_line(p.tool_name, p.content))
                if isinstance(p, ToolReturnPart)
                else p
                for p in m.parts
            ]
            m = dataclasses.replace(m, parts=parts)
        out.append(m)
    return out
