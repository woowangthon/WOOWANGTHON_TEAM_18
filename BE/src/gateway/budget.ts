// 티켓당 도구 호출 제한(docs/design/AIagent.md §3 "전체 제한"). 게이트웨이가 센다.
// simple: BE 메모리에만 둔다. 서버가 다시 뜨면 그 티켓은 처음부터 다시 센다(EC2 한 대, 대회 기간).

/** 티켓 하나에서 부를 수 있는 도구 수(submit_result는 세지 않는다). */
export const TOTAL_CALLS = 20
/** 에이전트 작업 시간(첫 호출부터). 파이프라인을 기다리는 실행 도구가 아직 없어 빼는 시간도 없다. */
export const WORK_MS = 15 * 60_000
/** 같은 도구 · 같은 인자는 연속으로 이만큼까지(그다음은 막는다). */
export const MAX_REPEAT = 2

export type BudgetCode = 'TOOL_LIMIT' | 'TIME_LIMIT' | 'REPEATED_CALL'

interface Usage {
  total: number
  startedAt: number
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

  /** 부르기 전에 묻는다. 막으면 그 코드, 아니면 null이고 이 호출을 센다. 막은 호출은 세지 않는다. */
  take(ticketId: string, tool: string, args: Record<string, unknown>): BudgetCode | null {
    const now = this.now()
    const usage = this.usage.get(ticketId) ?? { total: 0, startedAt: now, lastKey: null, repeats: 0 }
    if (now - usage.startedAt > WORK_MS) return 'TIME_LIMIT'
    if (usage.total >= TOTAL_CALLS) return 'TOOL_LIMIT'
    const key = `${tool} ${JSON.stringify(stable(args))}`
    const repeats = key === usage.lastKey ? usage.repeats + 1 : 1
    if (repeats > MAX_REPEAT) return 'REPEATED_CALL'
    this.usage.set(ticketId, { total: usage.total + 1, startedAt: usage.startedAt, lastKey: key, repeats })
    return null
  }

  /** 결과를 받았거나 티켓이 끝났다. */
  forget(ticketId: string): void {
    this.usage.delete(ticketId)
  }
}
