"""차례대로 답하는 대역 모델(PydanticAI FunctionModel). 실제 LLM은 부르지 않는다."""

import json
from collections.abc import Callable
from typing import Any

from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

Step = Callable[[list[ModelMessage], AgentInfo], ModelResponse]


def call(tool: str, **args: Any) -> Step:
    """도구 하나를 부른다."""
    return lambda messages, info: ModelResponse(parts=[ToolCallPart(tool, args)])


def final(**output: Any) -> Step:
    """최종 출력(output_type)을 낸다."""
    return lambda messages, info: ModelResponse(
        parts=[ToolCallPart(info.output_tools[0].name, output)]
    )


def fail(error: Exception) -> Step:
    def step(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        raise error

    return step


def text_of(messages: list[ModelMessage]) -> str:
    """모델에 간 요청 전체(지시문 · 프롬프트 · 도구 결과 · 재시도 안내)를 글 하나로."""
    out: list[str] = []
    for m in messages:
        if isinstance(m, ModelRequest) and m.instructions:
            out.append(m.instructions)
        for p in m.parts:
            for name in ("content", "args"):
                if hasattr(p, name):
                    value = getattr(p, name)
                    out.append(value if isinstance(value, str) else json.dumps(value, default=str))
    return "\n".join(out)


class Script:
    def __init__(self, *steps: Step) -> None:
        self.steps = list(steps)
        self.requests: list[list[ModelMessage]] = []
        self.infos: list[AgentInfo] = []
        self.model = FunctionModel(self._reply)

    def _reply(self, messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        self.requests.append(list(messages))
        self.infos.append(info)
        assert self.steps, "model was asked more often than the test scripted"
        return self.steps.pop(0)(messages, info)

    def sent(self, i: int = -1) -> str:
        return text_of(self.requests[i])

    @property
    def done(self) -> bool:
        return not self.steps
