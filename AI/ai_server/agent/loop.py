"""에이전트 실행: ① 코드 분류 → ② LLM 분류 → ③ playbook → ④ 실패 기반 재계획 / ⑤ planning.

결과는 코드가 게이트웨이의 `submit_result`로 한 번만 낸다. 모델에게는 그 도구를 주지 않는다.
봉투(ticketId · commitSha · 분류 · 실제 도구 호출)는 모델이 아니라 코드가 채운다.
"""

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field
from pydantic_ai import Agent, ModelRetry
from pydantic_ai.capabilities import ProcessHistory
from pydantic_ai.exceptions import AgentRunError, FallbackExceptionGroup, UnexpectedModelBehavior
from pydantic_ai.models import Model
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIChatModelSettings
from pydantic_ai.providers.openai import OpenAIProvider

from ai_server.agent import budget, prompts
from ai_server.agent.gateway import (
    SUBMIT_TOOL,
    GatewayRejected,
    GatewayStop,
    GatewayToolset,
    GatewayUnreachable,
    connect_gateway,
)
from ai_server.agent.memory import Case, CaseMemory
from ai_server.agent.models import (
    Action,
    AgentResult,
    Classification,
    ClassifyMethod,
    Outcome,
    ResultPath,
    Stage,
    Ticket,
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
    "LIVE_SLOT_PROTECTED": "대상 슬롯이 지금 서비스 중인 슬롯과 같아 보여 "
    "플랫폼 문제로 멈췄습니다.",
}


@dataclass(frozen=True)
class Models:
    local: Model
    # 추론 모델 API. 가림 필터를 거치고, 못 쓰면 로컬 모델로 넘어간다.
    planner: Model


def make_models(local: Model, api: Model | None, local_planning: Model | None = None) -> Models:
    """`local_planning`은 로컬 모델이 계획할 때 쓰는 설정(생각 모드)이다. 없으면 `local`."""
    planning = local_planning or local
    if api is None:
        return Models(local=local, planner=planning)
    return Models(local=local, planner=FallbackModel(RedactingModel(api), planning))


# 로컬 Qwen3(vLLM). vLLM의 `--max-model-len 16384`는 입력 + 출력의 합이라 출력에 상한을 둔다.
# 도구 고르기 · 분류는 생각 모드를 끈다: vLLM은 요청 본문의 `chat_template_kwargs`를 Qwen3의
# chat template에 넘기고, `enable_thinking: false`면 <think> 블록 없이 답한다.
LOCAL_ACT_SETTINGS = OpenAIChatModelSettings(
    max_tokens=2048, extra_body={"chat_template_kwargs": {"enable_thinking": False}}
)
# 추론 API가 없거나 실패해 로컬 모델이 계획할 때는 생각 모드를 켜고 출력을 더 준다.
LOCAL_PLAN_SETTINGS = OpenAIChatModelSettings(
    max_tokens=4096, extra_body={"chat_template_kwargs": {"enable_thinking": True}}
)


def _openai_compatible(
    url: Any, name: str, key: Any, settings: OpenAIChatModelSettings | None = None
) -> Model:
    api_key = key.get_secret_value() if key is not None else "unused"
    provider = OpenAIProvider(base_url=str(url), api_key=api_key)
    return OpenAIChatModel(name, provider=provider, settings=settings)


def models_from_settings(settings: Settings) -> Models | None:
    """로컬 모델 설정이 없으면 None(티켓마다 모델 설정 없음을 알리는 gave_up)."""
    url, name = settings.local_model_url, settings.local_model_name
    if url is None or name is None:
        return None

    def local(model_settings: OpenAIChatModelSettings) -> Model:
        return _openai_compatible(url, name, settings.local_model_api_key, model_settings)

    api = None
    if settings.planner_model_url is not None and settings.planner_model_name is not None:
        api = _openai_compatible(
            settings.planner_model_url, settings.planner_model_name, settings.planner_model_api_key
        )
    return make_models(local(LOCAL_ACT_SETTINGS), api, local(LOCAL_PLAN_SETTINGS))


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


async def _llm_classify(
    ticket: Ticket, notes: list[str], memory: CaseMemory, model: Model
) -> Case | None:
    cases = [c for c in memory.cases if c.stage == ticket.stage]
    agent = Agent(
        model,
        output_type=CaseChoice,
        instructions=prompts.CLASSIFY_INSTRUCTIONS,
        retries=OUTPUT_RETRIES,
    )
    choice = (await agent.run(prompts.classify_prompt(ticket, notes, cases))).output
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
        # 가장 최근 도구 결과만 전체로 두고 그 이전 결과는 한 줄 요약으로 바꾼다(컨텍스트 예산).
        capabilities=[ProcessHistory(budget.compact_history)],
    )
    return (await agent.run(prompt)).output


# 제출이 전송 오류로 실패하면 이만큼 기다렸다 다시 낸다(초).
SUBMIT_RETRY_DELAYS = (2.0, 5.0, 10.0)

_GATEWAY_DOWN = (
    "플랫폼 게이트웨이에 닿지 못해 멈췄습니다. 시도한 조치는 기록에 남아 있습니다. "
    "잠시 뒤 다시 배포해 주세요."
)
_NO_MODEL = (
    "AI 모델 설정이 없어 문제 해결을 하지 않았습니다. "
    "운영자가 AI 서버의 모델 설정을 넣어야 합니다. "
    "그 전에는 배포 설정과 로그를 직접 확인해 주세요."
)
_RESUBMITTED = (
    "에이전트의 결과가 플랫폼 검사에서 거절되어 결과 없이 멈췄습니다. "
    "배포 설정과 로그를 확인해 주세요."
)


def _last_rejection(actions: list[Action]) -> str | None:
    """마지막 거절 코드. 기록은 `rejected <code>: <message>`다."""
    for action in reversed(actions):
        if not action.ok and action.result and action.result.startswith("rejected "):
            return action.result.removeprefix("rejected ").split(":", 1)[0]
    return None


def _model_failure(e: Exception, actions: list[Action]) -> str:
    rejected = _last_rejection(actions)
    if (
        isinstance(e, UnexpectedModelBehavior)
        and isinstance(e.__cause__, ModelRetry)
        and rejected is not None
    ):
        # 게이트웨이 거절이 반복되어 도구 재시도 한도를 넘었다. 모델이 고장 난 것이 아니다.
        return (
            f"배포 설정 수정이 플랫폼 검사에서 계속 거절되어 멈췄습니다(마지막 거절: {rejected}). "
            "시도한 조치는 기록에 남아 있습니다. 배포 설정을 확인해 고친 뒤 다시 배포해 주세요."
        )
    return (
        f"AI 모델 호출이 실패해 원인을 찾지 못했습니다({type(e).__name__}). "
        "잠시 뒤 다시 배포해 주세요."
    )


async def _submit(gateway: GatewayToolset, result: AgentResult) -> None:
    """전송 오류면 몇 번 다시 낸다.

    INVALID_RESULT면 봉투와 사실 요약만 담은 gave_up으로 한 번 더 낸다.
    """
    delays = [0.0, *SUBMIT_RETRY_DELAYS]
    minimal_sent = False
    attempt = 0
    while attempt < len(delays):
        await asyncio.sleep(delays[attempt])
        try:
            async with gateway:
                await gateway.submit(result)
            log.info("ticket %s submitted %s", result.ticket_id, result.status)
            return
        except GatewayUnreachable as e:
            log.warning("ticket %s submit attempt %d: %s", result.ticket_id, attempt + 1, e)
            attempt += 1
        except GatewayRejected as e:
            if e.code != "INVALID_RESULT" or minimal_sent:
                log.error("ticket %s result not delivered: %s", result.ticket_id, e)
                return
            log.warning(
                "ticket %s result rejected as invalid; sending a minimal gave_up", result.ticket_id
            )
            result = AgentResult(
                ticket_id=result.ticket_id,
                commit_sha=result.commit_sha,
                classification=result.classification,
                actions=result.actions,
                status="gave_up",
                summary=_RESUBMITTED,
            )
            minimal_sent = True
    # 연결이 끝내 안 되면 결과를 낼 다른 길이 없다(AIagent.md 알려진 한계).
    log.error("ticket %s result not delivered: gateway unreachable", result.ticket_id)


def make_agent_runner(
    models: Models | None, gateway_for: Callable[[str], GatewayToolset]
) -> Runner:
    """`gateway_for(token)`이 그 티켓의 게이트웨이 연결을 만든다.

    `models`가 없으면 고치지 않고 그 사실만 알린다.
    """

    async def solve(run: TicketRun, memory: CaseMemory) -> None:
        # 코드 분류는 원본으로, 모델에는 받는 쪽에서 예산 안으로 자른 티켓을 준다.
        ticket, notes = budget.trim_ticket(run.ticket)
        gateway = gateway_for(run.gateway.token)
        case = memory.classify(run.ticket)
        method: ClassifyMethod = "code" if case else "llm"
        path: ResultPath = "playbook" if case else "plan"
        run.case_id = case.case_id if case else None
        try:
            if models is None:
                method = "code"
                outcome = Outcome(status="gave_up", summary=_NO_MODEL)
            else:
                async with gateway:
                    if case is None:
                        case = await _llm_classify(ticket, notes, memory, models.local)
                        path = "playbook" if case else "plan"
                        run.case_id = case.case_id if case else None
                    if case is None:
                        prompt = prompts.plan_prompt(ticket, notes)
                        outcome = await _act(models.planner, prompt, gateway, memory)
                    else:
                        prompt = prompts.playbook_prompt(ticket, notes, case)
                        outcome = await _act(models.local, prompt, gateway, memory)
                        if outcome.status == "gave_up":
                            path = "replan_after_playbook"
                            prompt = prompts.replan_prompt(
                                ticket, notes, case, gateway.actions, outcome.summary
                            )
                            outcome = await _act(models.planner, prompt, gateway, memory)
        except GatewayStop as stop:
            if stop.code == "TICKET_CLOSED":
                log.info("ticket %s closed by the gateway; no result", ticket.ticket_id)
                return
            outcome = Outcome(status="gave_up", summary=_STOP_SUMMARY[stop.code])
        except GatewayUnreachable as e:
            log.warning("ticket %s gateway unreachable: %s", ticket.ticket_id, e)
            outcome = Outcome(status="gave_up", summary=_GATEWAY_DOWN)
        except (AgentRunError, FallbackExceptionGroup) as e:
            # 그럴듯한 결과로 꾸미지 않고 해결 못 함과 그 이유를 알린다(F-1).
            log.warning("ticket %s model failure: %r", ticket.ticket_id, e)
            outcome = Outcome(status="gave_up", summary=_model_failure(e, gateway.actions))
        result = AgentResult(
            **outcome.model_dump(),
            ticket_id=ticket.ticket_id,
            commit_sha=ticket.commit_sha,
            classification=Classification(
                method=method, case_id=case.case_id if case else None, path=path
            ),
            actions=gateway.actions,
        )
        await _submit(gateway, result)

    return solve


def runner_from_settings(settings: Settings) -> Runner:
    url = str(settings.gateway_url)
    return make_agent_runner(
        models_from_settings(settings), lambda token: connect_gateway(url, token)
    )
