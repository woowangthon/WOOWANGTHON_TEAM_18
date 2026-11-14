"""에이전트 실행: ① 코드 분류 → ② LLM 분류 → ③ playbook → ④ 실패 기반 재계획 / ⑤ planning.

결과는 코드가 게이트웨이의 `submit_result`로 한 번만 낸다. 모델에게는 그 도구를 주지 않는다.
봉투(ticketId · commitSha · 분류 · 실제 도구 호출)는 모델이 아니라 코드가 채운다.
"""

import asyncio
import json
import logging
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field, ValidationError, model_validator
from pydantic_ai import Agent, ModelRetry
from pydantic_ai.capabilities import ProcessHistory
from pydantic_ai.exceptions import AgentRunError, FallbackExceptionGroup, UnexpectedModelBehavior
from pydantic_ai.models import Model
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIChatModelSettings
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.usage import RunUsage

from ai_server.agent import budget, prompts
from ai_server.agent.gateway import (
    SUBMIT_TOOL,
    GatewayRejected,
    GatewayStop,
    GatewayToolset,
    GatewayUnreachable,
    PlanBroken,
    connect_gateway,
)
from ai_server.agent.memory import Case, CaseMemory, PlaybookStep
from ai_server.agent.models import (
    Action,
    AgentResult,
    Classification,
    ClassifyMethod,
    Outcome,
    ResultPath,
    SpecPatchOp,
    Stage,
    Ticket,
    UserRequest,
)
from ai_server.agent.redact import RedactingModel, redact
from ai_server.agent.runs import Runner, TicketRun
from ai_server.agent.trace import classification, clean, exc_shape, trace
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
    act, plan = (
        local_model(settings, LOCAL_ACT_SETTINGS),
        local_model(settings, LOCAL_PLAN_SETTINGS),
    )
    if act is None or plan is None:
        return None
    return make_models(act, api_model(settings), plan)


def local_model(settings: Settings, model_settings: OpenAIChatModelSettings) -> Model | None:
    """로컬 모델(리더 vLLM). 설정이 없으면 None."""
    url, name = settings.local_model_url, settings.local_model_name
    if url is None or name is None:
        return None
    return _openai_compatible(url, name, settings.local_model_api_key, model_settings)


def api_model(settings: Settings) -> Model | None:
    """추론 모델 API(가림 필터 없이). 설정이 없으면 None."""
    if settings.planner_model_url is None or settings.planner_model_name is None:
        return None
    return _openai_compatible(
        settings.planner_model_url, settings.planner_model_name, settings.planner_model_api_key
    )


class CaseChoice(BaseModel):
    case_id: str | None = Field(description="caseId from the list, or null")


# 계획 하나의 JSON 글자 수 상한. 로컬 모델 입력 예산(budget.LOCAL_INPUT_CHARS) 안에 들게 한다.
PLAN_CHARS = 8_000


class Plan(BaseModel):
    """추론 모델이 case의 playbook을 참고해 내는 계획. 로컬 모델이 그대로 실행한다."""

    cause: str = Field(min_length=1, description="the likely cause in one line")
    steps: list[PlaybookStep] = Field(
        min_length=1, description="tool steps in order; the last is a submit_result finish step"
    )

    @model_validator(mode="after")
    def _valid_plan(self) -> "Plan":
        unknown = sorted({s.tool for s in self.steps} - prompts.GATEWAY_TOOLS)
        if unknown:
            raise ValueError(f"unknown tools {unknown}; use only {sorted(prompts.GATEWAY_TOOLS)}")
        # 2026-11-14 TEST_3: 계획이 path · find · replace를 files 밖에 적어 실행 첫 단계가 거절됐다.
        if any(
            s.tool == "edit_repo_file" and s.args and not isinstance(s.args.get("files"), list)
            for s in self.steps
        ):
            raise ValueError(
                "edit_repo_file args are { files: [{ path, find, replace }], message }; "
                "put each file inside files"
            )
        if len(self.model_dump_json()) > PLAN_CHARS:
            raise ValueError(f"the plan is longer than {PLAN_CHARS} characters; shorten it")
        return self


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
    ticket: Ticket, notes: list[str], memory: CaseMemory, model: Model, hints: list[Case]
) -> Case | None:
    """분류는 추론 모델이 한다. 정규식이 맞힌 case는 힌트로만 준다(최종 판단이 아니다)."""
    cases = [c for c in memory.cases if c.stage == ticket.stage]
    agent = Agent(
        model,
        output_type=CaseChoice,
        instructions=prompts.CLASSIFY_INSTRUCTIONS,
        retries=OUTPUT_RETRIES,
    )
    started = time.monotonic()
    result = await agent.run(prompts.classify_prompt(ticket, notes, cases, hints))
    choice = result.output
    # 목록에 없는 id는 모르는 것으로 본다(모델이 지어낸 case로 playbook을 돌리지 않는다).
    case = next((c for c in cases if c.case_id == choice.case_id), None)
    regex = ",".join(clean(c.case_id) for c in hints) or "none"
    trace(
        ticket.ticket_id,
        f"classify regex={regex} llm={clean(case.case_id) if case else 'none'} "
        f"{_usage(result.usage, started)}",
    )
    if case is not None:
        memory.hit(case)
    return case


async def _plan_steps(model: Model, prompt: str, gateway: GatewayToolset) -> Plan:
    """추론 모델이 읽기 도구로 증거를 본 뒤 계획을 낸다(edit_repo_file은 파일 전체 내용이 든다).

    읽기 거절은 모델에 돌려준다(strict가 아니다). 읽은 결과도 가림 필터를 거쳐 추론 API로 간다.
    """
    agent = Agent(
        model,
        output_type=Plan,
        instructions=prompts.PLAN_INSTRUCTIONS,
        toolsets=[gateway.filtered(lambda ctx, tool: tool.name in prompts.READ_TOOLS)],
        # 지난 읽기 결과를 줄이지 않는다(compact_history 없음): 읽은 파일 전체로 새 내용을 쓴다.
        retries=OUTPUT_RETRIES,
    )
    trace(gateway.trace_id, f"act model=planner name={clean(model.model_name)} (plan)")
    started = time.monotonic()
    before = len(gateway.actions)
    result = await agent.run(prompt)
    ran = result.response.model_name
    reads = ",".join(clean(a.tool) for a in gateway.actions[before:]) or "-"
    tools = ",".join(clean(s.tool) for s in result.output.steps)
    trace(
        gateway.trace_id,
        f"plan done ran={clean(ran) if ran else '-'} reads={reads} "
        f"steps={len(result.output.steps)} tools={tools} {_usage(result.usage, started)}",
    )
    plan: Plan = result.output
    return plan


async def _execute(model: Model, prompt: str, gateway: GatewayToolset, plan: Plan) -> Outcome:
    """로컬 모델이 계획을 실행한다. 계획에 있는 도구만 주고, 거절이면 PlanBroken으로 멈춘다."""
    allowed = {s.tool for s in plan.steps} - {SUBMIT_TOOL}
    agent = Agent(
        model,
        output_type=Outcome,
        instructions=prompts.EXECUTE_INSTRUCTIONS,
        toolsets=[gateway.filtered(lambda ctx, tool: tool.name in allowed)],
        retries=OUTPUT_RETRIES,
        # 가장 최근 도구 결과만 전체로 두고 그 이전 결과는 한 줄 요약으로 바꾼다(컨텍스트 예산).
        capabilities=[ProcessHistory(budget.compact_history)],
    )
    trace(gateway.trace_id, f"act model=local name={clean(model.model_name)}")
    started = time.monotonic()
    gateway.strict = True
    try:
        result = await agent.run(prompt)
    finally:
        gateway.strict = False
    ran = result.response.model_name
    trace(
        gateway.trace_id,
        f"act done model=local ran={clean(ran) if ran else '-'} {_usage(result.usage, started)}",
    )
    outcome: Outcome = result.output
    return outcome


async def _act(
    model: Model, label: str, prompt: str, gateway: GatewayToolset, memory: CaseMemory
) -> Outcome:
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
    # 어느 모델이 돌았는지 남긴다. planner는 추론 API가 안 되면 로컬로 넘어가므로
    # 실제로 응답한 모델 이름(ran)도 함께 남긴다.
    trace(gateway.trace_id, f"act model={label} name={clean(model.model_name)}")
    started = time.monotonic()
    result = await agent.run(prompt)
    ran = result.response.model_name
    trace(
        gateway.trace_id,
        f"act done model={label} ran={clean(ran) if ran else '-'} {_usage(result.usage, started)}",
    )
    return result.output


def _usage(usage: RunUsage, started: float) -> str:
    """모델 요청 수 · 입출력 토큰 · 걸린 시간(측정용, 값이 아니라 수만)."""
    return (
        f"requests={usage.requests} in_tokens={usage.input_tokens} "
        f"out_tokens={usage.output_tokens} seconds={time.monotonic() - started:.1f}"
    )


def _verified_patch(actions: list[Action]) -> list[SpecPatchOp] | None:
    """통과한 시험의 specPatch: 마지막 run_deploy가 성공했고 그 뒤 run_verify가 통과했을 때.

    게이트웨이는 verified의 specPatch가 그 시험 입력과 같아야 받는다(api.md 5번). 모델이 결과에
    다시 적으며 달라지면 시험을 통과한 해결이 INVALID_RESULT로 버려지므로 코드가 채운다.
    """
    deployed: list[Any] | None = None
    passed: list[Any] | None = None
    for action in actions:
        if action.tool == "run_deploy":
            # 성공 · 실패 모두 대상 슬롯을 다시 올리므로 앞의 확인은 쓰지 않는다.
            deployed = ((action.args or {}).get("specPatch") or []) if action.ok else None
            passed = None
        elif action.tool == "run_verify" and action.ok and deployed is not None:
            passed = deployed
    if passed is None:
        return None
    try:
        return [SpecPatchOp.model_validate(op) for op in passed]
    except ValidationError:
        # 게이트웨이가 받은 패치는 이 모양을 지킨다. 아니면 모델이 낸 값을 그대로 둔다.
        return None


# env · buildEnv 값을 넣는 패치 경로. 키 하나(`.../buildEnv/KEY`)이거나 객체 통째(`.../buildEnv`)다.
_ENV_PATH = re.compile(r"^/spec/services/\d+/(?:build/buildEnv|runtime/env)(?:/(?P<key>[^/]+))?$")


def _invented_env_keys(patch: list[SpecPatchOp], evidence: list[str]) -> list[str]:
    """패치가 넣는 env 값 중 티켓 · 도구 결과 어디에도 없는 값의 키.

    모델은 비밀값을 모른다. 레포 · 로그에 없는 값은 지어낸 것이라 시험을 통과해도 해결로
    내지 않는다(2026-11-14 실서비스 B3: 비밀값 VITE_API_KEY에 지어낸 값을 넣어 verified).
    """
    invented: list[str] = []
    for op in patch:
        m = _ENV_PATH.match(op.path)
        if m is None or op.op == "remove":
            continue
        pairs = {m["key"]: op.value} if m["key"] else op.value
        if not isinstance(pairs, dict):
            continue
        for key, value in pairs.items():
            # 증거는 모두 JSON 글이라 값도 JSON 문자열 안의 모양(이스케이프)으로 찾는다.
            escaped = json.dumps(str(value), ensure_ascii=False)[1:-1]
            if not any(escaped in seen for seen in evidence):
                invented.append(str(key))
    return invented


def _invented_needs_user(outcome: Outcome, keys: list[str]) -> Outcome:
    names = ", ".join(keys)
    return Outcome(
        status="needs_user",
        user_request=UserRequest(
            message=(
                f"env 값({names})을 레포나 로그에서 찾지 못했습니다. 비밀값이거나 학생만 아는 "
                "값이라 AI가 채우지 않았습니다. 배포 설정에 값을 직접 넣고 다시 배포해 주세요."
            )
        ),
        evidence=outcome.evidence,
        summary=(
            f"빌드 · 실행 env {names}가 없어 실패했습니다. 값을 레포에서 찾을 수 없어 "
            "학생이 넣어야 합니다."
        ),
    )


def _fit_to_gateway(outcome: Outcome, opened_pr_url: str | None) -> Outcome:
    """결과를 게이트웨이 검사(BE/src/gateway/result.ts · tools.ts)에 맞춘다.

    specPatch · buildOverrides는 verified 전용이라 다른 결과에 있으면 비어 있어도 INVALID_RESULT다.
    pr_opened의 pr.url은 open_pr가 돌려준 주소와 같아야 한다. 모델이 결과에 다시 적으면 어긋나므로
    코드가 채운다(2026-11-14 실측: pr_opened 6건이 모두 INVALID_RESULT로 거절).
    """
    update: dict[str, Any] = {}
    if outcome.status != "verified":
        update |= {"spec_patch": None, "build_overrides": None}
    if outcome.status == "pr_opened" and outcome.pr is not None and opened_pr_url is not None:
        update["pr"] = outcome.pr.model_copy(update={"url": opened_pr_url})
    return outcome.model_copy(update=update) if update else outcome


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
            # 게이트웨이의 거절 이유(칸 이름 · 규칙 문장, result.ts)를 남긴다. 메시지에 모델이 만든
            # 경로(specPatch의 op.path 등)가 섞일 수 있어 비밀값 모양은 가린다(FR-102와 같은 필터).
            log.warning(
                "ticket %s result rejected as invalid (%s); sending a minimal gave_up",
                result.ticket_id,
                budget.clip_line(redact(e.message), 300),
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


def _rejected_summary(code: str) -> str:
    return (
        f"배포 설정 수정이 플랫폼 검사에서 거절되어 멈췄습니다(거절: {code}). "
        "시도한 조치는 기록에 남아 있습니다. 배포 설정을 확인해 고친 뒤 다시 배포해 주세요."
    )


def make_agent_runner(
    models: Models | None, gateway_for: Callable[[str], GatewayToolset]
) -> Runner:
    """`gateway_for(token)`이 그 티켓의 게이트웨이 연결을 만든다.

    `models`가 없으면 고치지 않고 그 사실만 알린다.
    """

    async def solve(run: TicketRun, memory: CaseMemory) -> None:
        # 코드 분류는 원본으로, 모델에는 받는 쪽에서 예산 안으로 자른 티켓을 준다.
        ticket, notes = budget.trim_ticket(run.ticket)
        started = time.monotonic()
        gateway = gateway_for(run.gateway.token)
        gateway.trace_id = ticket.ticket_id
        # 정규식(①)은 힌트다. 분류는 추론 모델이 한다(models가 없을 때만 정규식으로 기록한다).
        hints = memory.candidates(run.ticket)
        case: Case | None = None
        method: ClassifyMethod = "llm"
        path: ResultPath = "plan"
        run.case_id = None
        raised = "-"
        try:
            if models is None:
                case = memory.classify(run.ticket)
                method = "code"
                path = "playbook" if case else "plan"
                run.case_id = case.case_id if case else None
                trace(ticket.ticket_id, classification(run.case_id, "code"))
                outcome = Outcome(status="gave_up", summary=_NO_MODEL)
            else:
                async with gateway:
                    case = await _llm_classify(ticket, notes, memory, models.planner, hints)
                    path = "playbook" if case else "plan"
                    run.case_id = case.case_id if case else None
                    if case is None:
                        prompt = prompts.plan_prompt(ticket, notes)
                        outcome = await _act(models.planner, "planner", prompt, gateway, memory)
                    else:
                        try:
                            # 계획은 추론 모델, 도구 호출은 로컬 모델.
                            plan = await _plan_steps(
                                models.planner,
                                prompts.plan_steps_prompt(ticket, notes, case),
                                gateway,
                            )
                            outcome = await _execute(
                                models.local,
                                prompts.execute_prompt(ticket, notes, plan.cause, plan.steps),
                                gateway,
                                plan,
                            )
                        except PlanBroken as e:
                            # 로컬 모델이 거절을 받으면 혼자 다시 시도하지 않고 바로 재계획한다.
                            trace(
                                ticket.ticket_id,
                                f"plan broken tool={clean(e.tool)} rejected={clean(e.code)}",
                            )
                            outcome = Outcome(status="gave_up", summary=_rejected_summary(e.code))
                        except UnexpectedModelBehavior as e:
                            # 출력이 계속 깨졌다. 끝내지 않고 아래에서 추론 모델로 다시 계획한다.
                            trace(ticket.ticket_id, f"act failed exc={exc_shape(e)}")
                            outcome = Outcome(
                                status="gave_up", summary=_model_failure(e, gateway.actions)
                            )
                        if outcome.status == "gave_up":
                            path = "replan_after_playbook"
                            trace(ticket.ticket_id, f"path={path} (plan gave up)")
                            prompt = prompts.replan_prompt(
                                ticket, notes, case, gateway.actions, outcome.summary
                            )
                            outcome = await _act(models.planner, "planner", prompt, gateway, memory)
        except GatewayStop as stop:
            raised = f"GatewayStop code={clean(stop.code)}"
            if stop.code == "TICKET_CLOSED":
                log.info("ticket %s closed by the gateway; no result", ticket.ticket_id)
                trace(
                    ticket.ticket_id,
                    f"outcome closed elapsed={time.monotonic() - started:.1f}s exc={raised}",
                )
                return
            outcome = Outcome(status="gave_up", summary=_STOP_SUMMARY[stop.code])
        except GatewayUnreachable as e:
            raised = exc_shape(e)
            log.warning("ticket %s gateway unreachable: %s", ticket.ticket_id, e)
            outcome = Outcome(status="gave_up", summary=_GATEWAY_DOWN)
        except (AgentRunError, FallbackExceptionGroup) as e:
            # 그럴듯한 결과로 꾸미지 않고 해결 못 함과 그 이유를 알린다(F-1).
            raised = exc_shape(e)
            log.warning("ticket %s model failure: %r", ticket.ticket_id, e)
            outcome = Outcome(status="gave_up", summary=_model_failure(e, gateway.actions))
        if outcome.status == "verified" and (patch := _verified_patch(gateway.actions)) is not None:
            outcome = outcome.model_copy(update={"spec_patch": patch})
        if outcome.status == "verified" and (
            invented := _invented_env_keys(
                outcome.spec_patch or [], [run.ticket.model_dump_json(), *gateway.seen]
            )
        ):
            trace(
                ticket.ticket_id,
                f"verified env not in evidence keys={','.join(clean(k) for k in invented)} "
                "-> needs_user",
            )
            outcome = _invented_needs_user(outcome, invented)
        outcome = _fit_to_gateway(outcome, gateway.opened_pr_url)
        result = AgentResult(
            **outcome.model_dump(),
            ticket_id=ticket.ticket_id,
            commit_sha=ticket.commit_sha,
            classification=Classification(
                method=method, case_id=case.case_id if case else None, path=path
            ),
            actions=gateway.actions,
        )
        trace(
            ticket.ticket_id,
            f"outcome status={outcome.status} path={path} actions={len(gateway.actions)} "
            f"elapsed={time.monotonic() - started:.1f}s exc={raised}",
        )
        await _submit(gateway, result)

    return solve


def runner_from_settings(settings: Settings) -> Runner:
    url = str(settings.gateway_url)
    return make_agent_runner(
        models_from_settings(settings), lambda token: connect_gateway(url, token)
    )
