import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Env } from '../config/env.js'

const TIMEOUT_MS = 10_000

/** AI 서버 `POST /agent/tickets`의 요청 본문(docs/design/api.md "AI 에이전트"). 값은 이미 외부 전송 필터를 거친 것이다. */
export interface TicketRequest {
  ticket: Record<string, unknown>
  gateway: { token: string; expiresAt: string }
}

/** 문제 티켓을 AI 서버에 보낸다. 받지 못하면 false(이유는 로그에만 남기고, 본문과 토큰은 싣지 않는다). */
@Injectable()
export class AgentClient {
  private readonly logger = new Logger(AgentClient.name)
  private readonly url: string | undefined
  private readonly token: string | undefined

  constructor(config: ConfigService<Env, true>) {
    this.url = config.get('AI_SERVER_URL', { infer: true })
    this.token = config.get('AGENT_API_TOKEN', { infer: true })
  }

  async sendTicket(request: TicketRequest): Promise<boolean> {
    return this.post('/agent/tickets', request, 202)
  }

  /** 종료 알림(api.md `POST /agent/tickets/{ticketId}/close`). 받지 못해도 실행 기록은 이미 끝났으므로 로그만 남긴다. */
  async close(ticketId: string, commitSha: string, reason: 'success' | 'superseded' | 'stopped'): Promise<boolean> {
    return this.post(`/agent/tickets/${encodeURIComponent(ticketId)}/close`, { ticketId, commitSha, reason }, 204)
  }

  private async post(path: string, body: object, expected: number): Promise<boolean> {
    if (!this.url || !this.token) {
      this.logger.error('AI_SERVER_URL and AGENT_API_TOKEN must both be set to call the AI server')
      return false
    }
    try {
      const res = await fetch(`${this.url}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      await res.arrayBuffer()
      if (res.status !== expected) this.logger.error(`AI server answered ${res.status} to POST ${path.split('/').slice(0, 3).join('/')}`)
      return res.status === expected
    } catch (err) {
      this.logger.error(err)
      return false
    }
  }
}
