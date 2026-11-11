// 티켓당 도구 호출 제한(docs/design/AIagent.md §3 "전체 제한", api.md "파이프라인 ↔ 플랫폼 서버" 4번 "시간"). 게이트웨이가 센다.
// simple: BE 메모리에만 둔다. 서버가 다시 뜨면 그 티켓은 처음부터 다시 센다(EC2 한 대, 대회 기간).

/** 티켓 하나에서 부를 수 있는 도구 수(submit_result는 세지 않는다). */
export const TOTAL_CALLS = 20
/** 에이전트 작업 시간(첫 호출부터, 시험 대기는 뺀다). */
export const WORK_MS = 15 * 60_000
/** 티켓 전체 상한(티켓 시작부터, 시험 대기 포함). */
export const TICKET_MS = 60 * 60_000
/** 같은 도구 · 같은 인자는 연속으로 이만큼까지(그다음은 막는다). */
export const MAX_REPEAT = 2
/** 도구별 티켓당 횟수(AIagent.md §3 표). 없는 도구는 전체 횟수만 센다. */
export const TOOL_CALLS: Record<string, number> = { run_render: 5, run_deploy: 2, run_verify: 3 }

export type BudgetCode = 'TOOL_LIMIT' | 'TIME_LIMIT' | 'REPEATED_CALL'

interface Usage {
  /** 티켓 시작(첫 토큰 만료 - 15분). */
  ticketStart: number
  total: number
  perTool: Record<string, number>
  startedAt: number
  waited: number
  lastKey: string | null
  repeats: number
}

/** 키 순서와 상관없이 같은 인자는 같은 글이 되게 한다. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, stable(v)]),
    )
  }
  return value
}

export class ToolBudget {
  private readonly usage = new Map<string, Usage>()

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * 부르기 전에 묻는다. 막으면 그 코드, 아니면 null이고 이 호출을 센다. 막은 호출은 세지 않는다.
   * `ticketStart`는 처음 본 티켓에만 쓴다(그 뒤에는 토큰 만료가 시험 대기로 늘어나 거꾸로 셀 수 없다).
   */
  take(ticketId: string, tool: string, args: Record<string, unknown>, ticketStart: number): BudgetCode | null {
    const now = this.now()
    const usage = this.usage.get(ticketId) ?? { ticketStart, total: 0, perTool: {}, startedAt: now, waited: 0, lastKey: null, repeats: 0 }
    if (now - usage.startedAt - usage.waited > WORK_MS || now >= usage.ticketStart + TICKET_MS) return 'TIME_LIMIT'
    if (usage.total >= TOTAL_CALLS) return 'TOOL_LIMIT'
    const used = usage.perTool[tool] ?? 0
    if (TOOL_CALLS[tool] !== undefined && used >= TOOL_CALLS[tool]) return 'TOOL_LIMIT'
    const key = `${tool} ${JSON.stringify(stable(args))}`
    const repeats = key === usage.lastKey ? usage.repeats + 1 : 1
    if (repeats > MAX_REPEAT) return 'REPEATED_CALL'
    this.usage.set(ticketId, { ...usage, total: usage.total + 1, perTool: { ...usage.perTool, [tool]: used + 1 }, lastKey: key, repeats })
    return null
  }

  /** 지금 시작하는 시험 대기의 상한: 30분과 티켓 전체 상한까지 남은 시간 중 짧은 쪽. take를 통과한 티켓만 묻는다. */
  waitCap(ticketId: string, trialWaitMs: number): number {
    const u = this.usage.get(ticketId)!
    return Math.max(0, Math.min(trialWaitMs, u.ticketStart + TICKET_MS - this.now()))
  }

  /** 시험 대기를 시작할 때의 토큰 만료: min(티켓 시작 + 60분, 지금 + 남은 15분 예산 + 이번 대기 상한). */
  expiryAtWaitStart(ticketId: string, cap: number): number {
    const u = this.usage.get(ticketId)!
    const now = this.now()
    const workLeft = Math.max(0, WORK_MS - (now - u.startedAt - u.waited))
    return Math.min(u.ticketStart + TICKET_MS, now + workLeft + cap)
  }

  /**
   * 시험 대기를 마쳤다. 기다린 시간을 작업 시간에서 빼고, 새 토큰 만료 min(티켓 시작 + 60분, 티켓 시작 + 15분 + 누적 대기)를 돌려준다.
   * 기다리는 사이 티켓이 끝났으면(결과 제출) null.
   */
  endWait(ticketId: string, waitedMs: number): number | null {
    const u = this.usage.get(ticketId)
    if (!u) return null
    u.waited += waitedMs
    return Math.min(u.ticketStart + TICKET_MS, u.ticketStart + WORK_MS + u.waited)
  }

  /** 결과를 받았거나 티켓이 끝났다. */
  forget(ticketId: string): void {
    this.usage.delete(ticketId)
  }
}
