import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import type { Slot } from '../deploys/deploy-condition.js'
import type { StoredFailure } from '../deploys/deploy-run.js'
import { DeploysStore } from '../deploys/deploys.store.js'

/** 게이트웨이 토큰이 가리키는 티켓. 도구에는 ticketId 인자가 없다(api.md "AI 에이전트"). */
export interface GatewayTicket {
  deployId: string
  ticketId: string
  slug: string
  repo: string
  commitSha: string
  targetSlot: Slot
  /** spec.services[].name — 도구의 `service` 인자는 이 안에서만 받는다. */
  services: string[]
  failure: StoredFailure | null
}

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

/** 토큰을 티켓으로 바꾼다. 모르는 토큰, 끝난 티켓(fixing이 아님), 만료된 토큰은 모두 null(TICKET_CLOSED)이다. */
@Injectable()
export class GatewayTickets {
  constructor(private readonly store: DeploysStore) {}

  async resolve(token: string): Promise<GatewayTicket | null> {
    if (!/^gw_[A-Za-z0-9_-]{16,}$/.test(token)) return null
    const run = await this.store.findRunByGatewayToken(tokenHash(token))
    if (!run || run.status !== 'fixing' || !run.ticket_id || !run.gateway_expires_at) return null
    if (Date.parse(run.gateway_expires_at) <= Date.now()) return null
    const deploy = await this.store.findById(run.deploy_id)
    if (!deploy) return null
    const input = run.input as { commitSha: string; spec?: { services?: { name?: unknown }[] } }
    return {
      deployId: run.deploy_id,
      ticketId: run.ticket_id,
      slug: run.slug,
      repo: deploy.repo,
      commitSha: input.commitSha,
      targetSlot: run.target_slot,
      services: (input.spec?.services ?? []).map((s) => s.name).filter((n): n is string => typeof n === 'string'),
      failure: run.failure,
    }
  }
}
