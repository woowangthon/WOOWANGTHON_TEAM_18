import { randomBytes } from 'node:crypto'
import { BadRequestException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common'
import type { Issue } from '../deploys/deploy-input.js'
import type { Slot } from '../deploys/deploy-condition.js'
import { DeploysStore } from '../deploys/deploys.store.js'
import { PipelineClient, type TrialStages } from '../deploys/pipeline.client.js'
import { checkTrialResult, type TrialTool } from './trial-result.js'

// AI 에이전트의 시험 실행(api.md "파이프라인 ↔ 플랫폼 서버" 4번, ADR-014). 게이트웨이의 run_render · run_deploy · run_verify가
// 시험 전용 파이프라인(student-trial)을 실행하고 결과를 기다린다. 실행 기록의 상태(notify 상태 기계)는 바꾸지 않는다.
// simple: 시험 기록과 기다림은 BE 메모리에 둔다(EC2 한 대). 다시 뜨면 기다리던 호출은 끊기고, 시작할 때 남은 시험 인스턴스를 모두 취소한다.

export type { TrialTool } from './trial-result.js'
export { checkTrialResult } from './trial-result.js'

/** 시험 하나의 대기 상한. 티켓 전체 상한까지 남은 시간이 더 짧으면 그쪽에서 끝난다. */
export const TRIAL_WAIT_MS = 30 * 60_000

const STAGES: Record<TrialTool, TrialStages> = { run_render: 'render', run_deploy: 'prepare,render,apply', run_verify: 'verify' }
const TRIAL_ID = /^tr_[0-9a-f]{12}$/

export interface TrialFailure {
  stage: string | null
  code: string | null
  message: string
}

/** 파이프라인이 보낸 결과(도구 결과 모양 + failure) 또는 시험이 결과 없이 끝난 이유. */
export type TrialOutcome = { result: Record<string, unknown> } | { failure: TrialFailure }

interface Trial {
  id: string
  deployId: string
  ticketId: string
  slug: string
  slot: Slot
  tool: TrialTool
  input: Record<string, unknown>
  /** 입력을 읽은 job이 알린 GoCD 인스턴스 번호. 없으면 아직 입력을 읽은 job이 없다. */
  counter: number | null
  /** waiting: 결과를 기다림. ended: 결과를 받았거나 취소됨. stuck: 취소를 확인하지 못함(같은 프로젝트의 다음 시험을 막는다). */
  state: 'waiting' | 'ended' | 'stuck'
  finish: (outcome: TrialOutcome) => void
}

const closedFailure = (): TrialOutcome => ({ failure: { stage: null, code: 'TICKET_CLOSED', message: 'the ticket ended before the trial finished' } })
const notFound = () => new NotFoundException({ code: 'TRIAL_NOT_FOUND', message: 'No such open trial' })
const badResult = (message: string, fields: Issue[]) => new BadRequestException({ code: 'BAD_REQUEST', message, fields })

@Injectable()
export class GatewayTrials implements OnApplicationBootstrap {
  private readonly logger = new Logger(GatewayTrials.name)
  private readonly trials = new Map<string, Trial>()
  /** 티켓마다 마지막으로 성공한 run_deploy의 입력(run_verify가 쓴다). */
  private readonly lastDeploy = new Map<string, Record<string, unknown>>()
  /** 티켓마다 마지막 run_deploy의 입력으로 run_verify까지 통과한 입력(`verified`를 받는 조건, api.md 5번). 그 뒤 run_deploy를 부르면 지운다. */
  private readonly verified = new Map<string, Record<string, unknown>>()
  /** 끝난 티켓. 시험을 준비하던 호출이 티켓이 끝난 뒤 시험을 등록하지 못하게 한다(티켓 수만큼만 쌓인다). */
  private readonly closed = new Set<string>()
  /** BE 시작 때의 남은 시험 취소. 끝나기 전(성공 · 실패 모두)에는 새 시험을 시작하지 않는다. true면 확인됨. */
  private leftovers: Promise<boolean> = Promise.resolve(true)

  constructor(
    private readonly pipeline: PipelineClient,
    private readonly store: DeploysStore,
  ) {}

  /** `verified` 뒤 다시 실행 전, 끝난 시험을 다시 확인하기 전에 기다리는 시간(ms). */
  settleRetryMs = 3000

  /** BE가 시작할 때 남은 시험 인스턴스를 취소한다. 서버 시작은 막지 않고, 새 시험만 그 뒤로 미룬다. */
  onApplicationBootstrap(): void {
    this.leftovers = this.cancelLeftovers()
  }

  private cancelLeftovers(): Promise<boolean> {
    return this.pipeline.cancelAllTrials().then(
      (n) => {
        if (n > 0) this.logger.log(`cancelled ${n} leftover trial run(s)`)
        return true
      },
      (err: unknown) => {
        this.logger.error(err)
        return false
      },
    )
  }

  /** 이 티켓에 결과를 기다리는 시험이 있는가. */
  busy(ticketId: string): boolean {
    return [...this.trials.values()].some((t) => t.ticketId === ticketId && t.state === 'waiting')
  }

  lastDeployInput(ticketId: string): Record<string, unknown> | undefined {
    return this.lastDeploy.get(ticketId)
  }

  /** 이 티켓에서 run_deploy → run_verify를 통과한 입력. 없으면 undefined. */
  verifiedInput(ticketId: string): Record<string, unknown> | undefined {
    return this.verified.get(ticketId)
  }

  /**
   * 같은 프로젝트의 이전 시험이 모두 끝났는가(`verified` 뒤 다시 실행 전, api.md 4번 "순서"). 확인하지 못하면 잠시 기다렸다 한 번 더 본다.
   * 시작 때의 남은 시험 취소도 확인돼야 한다.
   */
  async settled(slug: string): Promise<boolean> {
    for (let attempt = 0; ; attempt++) {
      if (!(await this.leftovers)) this.leftovers = this.cancelLeftovers()
      if ((await this.leftovers) && (await this.previousEnded(slug))) return true
      if (attempt === 1) return false
      await new Promise((resolve) => setTimeout(resolve, this.settleRetryMs))
    }
  }

  /**
   * 시험을 실행하고 결과를 기다린다. 결과 없이 끝나면(실행 실패 · 이전 시험이 안 끝남 · 대기 초과) failure다.
   * `deadline`은 대기가 끝나는 절대 시각(ms)이다: 실행 요청 같은 앞 단계가 걸린 만큼 기다림이 줄어, 토큰 만료보다 늦게 기다리지 않는다.
   */
  async run(
    ticket: { deployId: string; ticketId: string; slug: string; targetSlot: Slot },
    tool: TrialTool,
    input: Record<string, unknown>,
    deadline: number,
  ): Promise<TrialOutcome> {
    // 시작 때 취소를 확인하지 못했으면 한 번 더 해 본다.
    if (!(await this.leftovers)) this.leftovers = this.cancelLeftovers()
    if (!(await this.leftovers) || !(await this.previousEnded(ticket.slug))) {
      return { failure: { stage: null, code: 'TRIAL_STILL_RUNNING', message: 'an earlier trial of this project could not be confirmed stopped' } }
    }
    // 위의 await 사이에 티켓이 끝났을 수 있다. 이 확인과 등록 사이에는 await가 없다.
    if (this.closed.has(ticket.ticketId)) return closedFailure()
    const id = `tr_${randomBytes(6).toString('hex')}`
    let finish!: (o: TrialOutcome) => void
    const done = new Promise<TrialOutcome>((resolve) => {
      finish = resolve
    })
    const trial: Trial = { id, deployId: ticket.deployId, ticketId: ticket.ticketId, slug: ticket.slug, slot: ticket.targetSlot, tool, input, counter: null, state: 'waiting', finish }
    this.trials.set(id, trial)
    // run_deploy는 대상 슬롯을 비우고 다시 올린다. 앞서 확인한 입력은 더 이상 슬롯에 떠 있다고 할 수 없다.
    if (tool === 'run_deploy') this.verified.delete(ticket.ticketId)
    try {
      await this.pipeline.runTrial(ticket.deployId, id, STAGES[tool])
    } catch {
      this.trials.delete(id)
      return { failure: { stage: null, code: 'PIPELINE_UNAVAILABLE', message: 'could not start the trial pipeline' } }
    }
    // 남은 시간이 없으면 바로 끝난다(아래에서 취소한다).
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<TrialOutcome>((resolve) => {
      timer = setTimeout(() => resolve({ failure: { stage: null, code: 'TRIAL_TIMEOUT', message: 'no trial result before the wait limit' } }), Math.max(0, deadline - Date.now()))
    })
    const outcome = await Promise.race([done, timeout])
    clearTimeout(timer)
    if (trial.state === 'waiting') await this.cancel(trial)
    const passed = 'result' in outcome && outcome.result.ok === true
    if (passed && tool === 'run_deploy') this.lastDeploy.set(ticket.ticketId, input)
    // 마지막으로 성공한 run_deploy의 입력을 확인했을 때만(그 입력이 지금 대상 슬롯에 떠 있다).
    if (passed && tool === 'run_verify' && this.lastDeploy.get(ticket.ticketId) === input) this.verified.set(ticket.ticketId, input)
    if (trial.state === 'ended') this.trials.delete(id)
    return outcome
  }

  /** 티켓이 끝났다(결과 제출 · 종료). 기다리는 시험이 있으면 취소한다. */
  async endTicket(ticketId: string): Promise<void> {
    this.closed.add(ticketId)
    this.lastDeploy.delete(ticketId)
    this.verified.delete(ticketId)
    for (const t of [...this.trials.values()]) {
      if (t.ticketId === ticketId && t.state === 'waiting') {
        await this.cancel(t)
        t.finish(closedFailure())
      }
    }
  }

  /** `GET /api/pipeline/trials/:trialId/input`. 열린 티켓에 속한, 아직 기다리는 시험만 읽을 수 있다. */
  async input(trialId: string, counterParam: unknown) {
    const trial = TRIAL_ID.test(trialId) ? this.trials.get(trialId) : undefined
    if (!trial || trial.state !== 'waiting') throw notFound()
    // 범위 안 job은 ?counter=<GO_PIPELINE_COUNTER>를 꼭 붙인다(취소할 인스턴스를 알아야 한다).
    if (counterParam === undefined) throw badResult('counter is required', [{ path: 'counter', code: 'REQUIRED' }])
    const counter = typeof counterParam === 'string' && /^\d{1,9}$/.test(counterParam) ? Number(counterParam) : NaN
    if (!Number.isInteger(counter) || counter < 1) throw badResult('counter must be a positive integer', [{ path: 'counter', code: 'INVALID_VALUE' }])
    if (!(await this.runOpen(trial)) || !this.waiting(trial)) throw notFound()
    if (trial.counter !== null && trial.counter !== counter) throw badResult('another pipeline run already read this trial', [{ path: 'counter', code: 'CONFLICT' }])
    trial.counter = counter
    return { deployId: trial.deployId, slot: trial.slot, input: trial.input, buildOverrides: null }
  }

  /** `POST /api/pipeline/trials/:trialId/result`. 모르는 · 끝난 시험의 결과는 아무것도 바꾸지 않는다(재전송 · 늦은 결과에 안전). */
  async result(trialId: string, body: unknown): Promise<{ ok: true; applied: boolean }> {
    const trial = TRIAL_ID.test(trialId) ? this.trials.get(trialId) : undefined
    if (!trial || trial.state !== 'waiting') return { ok: true, applied: false }
    const issues = checkTrialResult(trial.tool, body)
    if (issues.length > 0) throw badResult('Trial result has invalid fields', issues)
    // 실행 기록이 그 티켓으로 열려 있을 때만 받는다(티켓이 끝났으면 늦은 결과다).
    if (!(await this.runOpen(trial))) return { ok: true, applied: false }
    // await 사이에 취소 · 대기 초과가 시험을 끝냈을 수 있다. 이 확인과 ended 사이에는 await가 없다.
    if (!this.waiting(trial)) return { ok: true, applied: false }
    trial.state = 'ended'
    trial.finish({ result: (body as { result: Record<string, unknown> }).result })
    return { ok: true, applied: true }
  }

  /** 실행 기록이 그 티켓으로 fixing인가. */
  private async runOpen(trial: Trial): Promise<boolean> {
    const run = await this.store.findRun(trial.deployId)
    return Boolean(run && run.status === 'fixing' && run.ticket_id === trial.ticketId)
  }

  /** 시험이 아직 기다리는가(맵에 같은 객체). await 뒤 상태를 바꾸기 바로 전에 부른다. */
  private waiting(trial: Trial): boolean {
    return this.trials.get(trial.id) === trial && trial.state === 'waiting'
  }

  private async cancel(trial: Trial): Promise<void> {
    // 입력을 읽은 job이 없으면 그 인스턴스는 나중에 입력을 읽어도 404라 슬롯을 건드리지 않는다.
    if (trial.counter === null) {
      trial.state = 'ended'
      return
    }
    // 취소를 부르는 동안 오는 입력 읽기 · 결과는 받지 않는다(waiting이 아니다).
    trial.state = 'stuck'
    if (await this.pipeline.cancelTrial(trial.counter)) trial.state = 'ended'
    if (trial.state === 'stuck') this.logger.error(`could not cancel trial ${trial.id}`)
  }

  /** 같은 프로젝트의 이전 시험이 모두 끝났는가. 취소를 확인하지 못한 시험은 한 번 더 취소해 본다. */
  private async previousEnded(slug: string): Promise<boolean> {
    for (const t of [...this.trials.values()]) {
      if (t.slug !== slug || t.state !== 'stuck') continue
      await this.cancel(t)
      if (t.state === 'stuck') return false
      this.trials.delete(t.id)
    }
    return true
  }
}
