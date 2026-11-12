import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import type { Slot } from '../deploys/deploy-condition.js'
import type { StoredFailure } from '../deploys/deploy-run.js'
import { DeploysStore } from '../deploys/deploys.store.js'
import { TICKET_MS, WORK_MS } from './budget.js'

/** 이 프로세스가 뜬 시각. 그 전에 마지막으로 바뀐 티켓은 이전 프로세스(재시작 전)가 다뤘다. */
const PROCESS_START = Date.now()

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
  /** 토큰 만료(ms). */
  expiresAt: number
  /**
   * 티켓 시작(ms). 저장하지 않으므로 만료에서 거꾸로 센다. budget은 처음 본 티켓에만 이 값을 쓴다.
   * 이 프로세스가 낸 티켓(마지막 갱신이 프로세스 시작 뒤)을 처음 보면 만료는 아직 처음 값(발급 + 15분)이라 만료 - 15분이다.
   * 재시작 전에 다룬 티켓은 만료가 시험 대기로 늘었을 수 있어 보수적으로 만료 - 60분으로 본다: 실제 시작보다 앞이라 60분 상한이 늘지 않고,
   * 그 뒤에는 저장된 만료를 넘어 늘리지 못한다(api.md "파이프라인 ↔ 플랫폼 서버" 4번 "기다림").
   */
  ticketStart: number
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
    const expiresAt = Date.parse(run.gateway_expires_at)
    if (expiresAt <= Date.now()) return null
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
      expiresAt,
      ticketStart: Date.parse(run.updated_at) >= PROCESS_START ? expiresAt - WORK_MS : expiresAt - TICKET_MS,
    }
  }
}
