"""티켓마다의 실행 기록. 같은 ticketId를 다시 받으면 이 기록으로 같은 202를 준다."""

import asyncio
import logging
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from typing import Any

from ai_server.agent.memory import CaseMemory
from ai_server.agent.models import GatewayGrant, Ticket

log = logging.getLogger(__name__)


@dataclass
class TicketRun:
    ticket: Ticket
    gateway: GatewayGrant
    # 이 티켓에 쓴 case. 종료 알림이 success면 이 case의 stats.solved를 올린다.
    case_id: str | None = None
    closed: bool = False
    task: asyncio.Task[None] | None = field(default=None, repr=False)

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()


Runner = Callable[[TicketRun, CaseMemory], Coroutine[Any, Any, None]]


class RunRegistry:
    """티켓별 실행 기록.

    simple: 메모리에만 두어 재시작하면 잊는다. 플랫폼은 그 뒤 같은 티켓을 다시 보내거나
    시간 초과로 멈춘다.
    """

    def __init__(self, memory: CaseMemory, runner: Runner, max_running: int) -> None:
        self.memory = memory
        self._runner = runner
        self._max_running = max_running
        self._runs: dict[str, TicketRun] = {}

    def get(self, ticket_id: str) -> TicketRun | None:
        return self._runs.get(ticket_id)

    def busy(self) -> bool:
        return sum(r.running for r in self._runs.values()) >= self._max_running

    def start(self, ticket: Ticket, gateway: GatewayGrant) -> TicketRun:
        run = TicketRun(ticket=ticket, gateway=gateway)
        self._runs[ticket.ticket_id] = run
        run.task = asyncio.create_task(self._run(run))
        return run

    async def _run(self, run: TicketRun) -> None:
        try:
            await self._runner(run, self.memory)
        except Exception:  # 취소(CancelledError)는 Exception이 아니라 그대로 올라간다
            # 실패를 결과로 꾸미지 않는다(F-1). 플랫폼은 시간 초과로 멈춘다.
            log.exception("ticket %s run failed", run.ticket.ticket_id)

    def close(self, run: TicketRun, success: bool) -> None:
        if run.closed:
            return
        run.closed = True
        if run.task is not None:
            run.task.cancel()
        if success and run.case_id is not None:
            self.memory.record_solved(run.case_id)
