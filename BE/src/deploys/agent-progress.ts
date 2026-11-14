import { Injectable } from '@nestjs/common'

/** 학생 화면에 보일 AI의 지금 모습(api.md "진행 상태 읽기"의 `agentProgress`). 도구 이름과 횟수만 담는다. */
export interface AgentProgressView {
  tool: string
  calls: number
  limit: number
  at: string
}

/**
 * 티켓마다 가장 최근에 부른 도구. 게이트웨이가 쓰고 진행 상태 읽기가 읽는다.
 * simple: BE 메모리에만 둔다(budget과 같다). 서버가 다시 뜨면 비어서 null로 보인다.
 */
@Injectable()
export class AgentProgress {
  private readonly last = new Map<string, AgentProgressView>()

  record(ticketId: string, tool: string, calls: number, limit: number): void {
    this.last.set(ticketId, { tool, calls, limit, at: new Date().toISOString() })
  }

  read(ticketId: string): AgentProgressView | null {
    return this.last.get(ticketId) ?? null
  }

  forget(ticketId: string): void {
    this.last.delete(ticketId)
  }
}
