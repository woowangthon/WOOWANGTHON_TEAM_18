"""에이전트 실행: ① 코드 분류 → ② LLM 분류 → ③ playbook → ④ 실패 기반 재계획 / ⑤ planning.

결과는 코드가 게이트웨이의 `submit_result`로 한 번만 낸다. 모델에게는 그 도구를 주지 않는다.
봉투(ticketId · commitSha · 분류 · 실제 도구 호출)는 모델이 아니라 코드가 채운다.
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.exceptions import AgentRunError, FallbackExceptionGroup
from pydantic_ai.models import Model
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from ai_server.agent import prompts
from ai_server.agent.gateway import SUBMIT_TOOL, GatewayStop, GatewayToolset, connect_gateway
from ai_server.agent.memory import Case, CaseMemory
from ai_server.agent.models import (
    AgentResult,
    Classification,
    ClassifyMethod,
    Outcome,
    ResultPath,
    Stage,
)
from ai_server.agent.redact import RedactingModel
from ai_server.agent.runs import Runner, TicketRun
from ai_server.config import Settings

log = logging.getLogger(__name__)

OUTPUT_RETRIES = 2

# 게이트웨이가 멈춘 이유 → 학생에게 보일 설명과 할 일 (FR-101)
_STOP_SUMMARY = {
    "TOOL_LIMIT": "도구 호출 횟수 한도에 닿아 멈췄습니다. 시도한 조치는 기록에 남아 있습니다. "
    "배포 설정과 로그를 확인해 고친 뒤 다시 배포해 주세요.",
    "TIME_LIMIT": "에이전트 작업 시간 한도를 넘어 멈췄습니다. 시도한 조치는 기록에 남아 있습니다. "
    "배포 설정과 로그를 확인해 고친 뒤 다시 배포해 주세요.",
    "LIVE_SLOT_PROTECTED": "대상 슬롯이 지금 서비스 중인 슬롯과 같아 보여 플랫폼이 작업을 멈췄습니다. "
    "플랫폼 문제라 운영자에게 알렸습니다.",
}


@dataclass(frozen=True)
class Models:
    local: Model
    # 추론 모델 API. 가림 필터를 거치고, 못 쓰면 로컬 모델로 넘어간다.
    planner: Model


def make_models(local: Model, api: Model | None) -> Models:
    if api is None:
        return Models(local=local, planner=local)
    return Models(local=local, planner=FallbackModel(RedactingModel(api), local))


def _openai_compatible(url: Any, name: str, key: Any) -> Model:
    api_key = key.get_secret_value() if key is not None else "unused"
    return OpenAIChatModel(name, provider=OpenAIProvider(base_url=str(url), api_key=api_key))


def models_from_settings(settings: Settings) -> Models:
    local = _openai_compatible(
        settings.local_model_url, settings.local_model_name, settings.local_model_api_key
    )
    api = None
    if settings.planner_model_url is not None and settings.planner_model_name is not None:
        api = _openai_compatible(
            settings.planner_model_url, settings.planner_model_name, settings.planner_model_api_key
        )
    return make_models(local, api)


class CaseChoice(BaseModel):
    case_id: str | None = Field(description="caseId from the list, or null")


def _read_memory_tool(memory: CaseMemory) -> Callable[..., dict[str, Any]]:
    def read_memory(stage: Stage | None = None, case_id: str | None = None) -> dict[str, Any]:
        """Search the long-term memory of known failure cases and their playbooks."""
        cases = [
            c
            for c in memory.cases
            if (stage is None or c.stage == stage) and (case_id is None or c.case_id == case_id)
        ]
        return {"cases": [c.model_dump(mode="json", by_alias=True) for c in cases]}

    return read_memory


async def _llm_classify(run: TicketRun, memory: CaseMemory, model: Model) -> Case | None:
    cases = [c for c in memory.cases if c.stage == run.ticket.stage]
    agent = Agent(
        model,
        output_type=CaseChoice,
        instructions=prompts.CLASSIFY_INSTRUCTIONS,
        retries=OUTPUT_RETRIES,
    )
    choice = (await agent.run(prompts.classify_prompt(run.ticket, cases))).output
    # 목록에 없는 id는 모르는 것으로 본다(모델이 지어낸 case로 playbook을 돌리지 않는다).
    case = next((c for c in cases if c.case_id == choice.case_id), None)
    if case is not None:
        memory.hit(case)
    return case


async def _act(model: Model, prompt: str, gateway: GatewayToolset, memory: CaseMemory) -> Outcome:
    agent = Agent(
        model,
        output_type=Outcome,
        instructions=prompts.INSTRUCTIONS,
        toolsets=[gateway.filtered(lambda ctx, tool: tool.name != SUBMIT_TOOL)],
        tools=[_read_memory_tool(memory)],
        retries=OUTPUT_RETRIES,
    )
    return (await agent.run(prompt)).output


def make_agent_runner(models: Models, gateway_for: Callable[[str], GatewayToolset]) -> Runner:
    """`gateway_for(token)`이 그 티켓의 게이트웨이 연결을 만든다."""

    async def solve(run: TicketRun, memory: CaseMemory) -> None:
        ticket = run.ticket
        gateway = gateway_for(run.gateway.token)
        async with gateway:
            case = memory.classify(ticket)
            method: ClassifyMethod = "code" if case else "llm"
            path: ResultPath = "playbook" if case else "plan"
            try:
                if case is None:
                    case = await _llm_classify(run, memory, models.local)
                    path = "playbook" if case else "plan"
                run.case_id = case.case_id if case else None
                if case is None:
                    outcome = await _act(
                        models.planner, prompts.plan_prompt(ticket), gateway, memory
                    )
                else:
                    prompt = prompts.playbook_prompt(ticket, case)
                    outcome = await _act(models.local, prompt, gateway, memory)
                    if outcome.status == "gave_up":
                        path = "replan_after_playbook"
                        prompt = prompts.replan_prompt(
                            ticket, case, gateway.actions, outcome.summary
                        )
                        outcome = await _act(models.planner, prompt, gateway, memory)
            except GatewayStop as stop:
                if stop.code == "TICKET_CLOSED":
                    log.info("ticket %s closed by the gateway; no result", ticket.ticket_id)
                    return
                outcome = Outcome(status="gave_up", summary=_STOP_SUMMARY[stop.code])
            except (AgentRunError, FallbackExceptionGroup) as e:
                # 모델 호출이 실패했다. 그럴듯한 결과로 꾸미지 않고 해결 못 함으로 알린다(F-1).
                log.warning("ticket %s model failure: %r", ticket.ticket_id, e)
                outcome = Outcome(
                    status="gave_up",
                    summary=f"AI 모델 호출이 실패해 원인을 찾지 못했습니다({type(e).__name__}). "
                    "잠시 뒤 다시 배포해 주세요.",
                )
            result = AgentResult(
                **outcome.model_dump(),
                ticket_id=ticket.ticket_id,
                commit_sha=ticket.commit_sha,
                classification=Classification(
                    method=method, case_id=case.case_id if case else None, path=path
                ),
                actions=gateway.actions,
            )
            await gateway.submit(result)
            log.info("ticket %s submitted %s", ticket.ticket_id, result.status)

    return solve


def runner_from_settings(settings: Settings) -> Runner:
    url = str(settings.gateway_url)
    return make_agent_runner(
        models_from_settings(settings), lambda token: connect_gateway(url, token)
    )
