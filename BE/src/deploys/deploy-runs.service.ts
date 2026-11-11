import { createHash, randomBytes } from 'node:crypto'
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../auth/auth.decorators.js'
import { parseUuid } from '../common/uuid.js'
import { redact, redactString } from '../common/redact.js'
import { AgentClient } from './agent.client.js'
import type { ServiceConditions } from './deploy-condition.js'
import { DeployPreparer } from './deploy-preparer.js'
import {
  buildSteps,
  checkImages,
  classifyFailure,
  type DeployStatus,
  type Failure,
  nextStage,
  type Notice,
  publicUrl,
  type Stage,
  type StepKey,
  type StepState,
  toFailure,
  validateNotice,
} from './deploy-run.js'
import { type DeployRow, type DeployRunRow, DeploysStore, StoreConflict } from './deploys.store.js'
import { PipelineClient } from './pipeline.client.js'

const TICKET_MINUTES = 15
// 파이프라인(빌드 포함)이 이보다 오래 걸리지 않는다고 본다. 이 시간 동안 아무 알림도 없던 진행 중인 실행은 끝난 것으로 본다.
const STALE_RUN_MS = 60 * 60_000
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

const notFound = () => new NotFoundException({ code: 'DEPLOY_NOT_FOUND', message: 'No such deploy' })

export interface DeployStatusView {
  deployId: string
  status: DeployStatus
  stage: Stage | null
  steps: { key: StepKey; state: StepState }[]
  failure: Failure | null
  url: string | null
  warnings: string[]
  updatedAt: string
}

const iso = (t: string) => new Date(t).toISOString()

/** 실행 기록(없을 수 있다)에서 읽기 응답을 만든다. 원본 · 로그 · 비밀값은 저장하지 않으므로 여기 올 수 없다. */
function view(deploy: DeployRow, run: DeployRunRow | undefined): DeployStatusView {
  const status: DeployStatus = run?.status ?? 'not_started'
  const stage = run?.stage ?? null
  return {
    deployId: deploy.id,
    status,
    stage,
    steps: buildSteps(status, stage),
    failure: run?.failure ? toFailure(run.failure) : null,
    url: status === 'succeeded' ? publicUrl(deploy.slug) : null,
    // 보안 검사 경고(#45)는 아직 없다.
    warnings: [],
    updatedAt: iso(run?.updated_at ?? deploy.created_at),
  }
}

@Injectable()
export class DeployRunsService {
  private readonly logger = new Logger(DeployRunsService.name)

  constructor(
    private readonly store: DeploysStore,
    private readonly preparer: DeployPreparer,
    private readonly pipeline: PipelineClient,
    private readonly agent: AgentClient,
  ) {}

  /** 내 배포 하나. 없는 id · 남의 id · UUID가 아닌 id는 모두 404다. */
  private async owned(user: AuthUser, id: string): Promise<DeployRow> {
    const uuid = parseUuid(id)
    const row = uuid ? await this.store.findOwned(uuid, user.id) : undefined
    if (!row) throw notFound()
    return row
  }

  /** 배포 입력으로 파이프라인을 한 번 실행한다. 확인 순서는 docs/design/api.md "배포 시작". */
  async start(user: AuthUser, id: string) {
    const deploy = await this.owned(user, id)
    if (await this.store.findRun(deploy.id)) throw alreadyStarted()
    // 준비 안 됨(409 NOT_READY)은 여기서 던져진다.
    const prepared = await this.preparer.prepareIfReady(deploy.id)
    const row = {
      deploy_id: deploy.id,
      user_id: user.id,
      slug: deploy.slug,
      target_slot: prepared.slot,
      input: prepared.input as unknown as Record<string, unknown>,
      status: 'running',
      stage: 'build',
    } as const
    try {
      await this.insertOrExpireStale(row)
    } catch (err) {
      if (!(err instanceof StoreConflict)) throw err
      // 같은 deploy_id(기본 키)면 이미 시작한 배포, 아니면 같은 프로젝트의 다른 배포가 도는 중이다.
      throw err.constraint.includes('deploy_runs_pkey') ? alreadyStarted() : inProgress()
    }
    try {
      await this.pipeline.run(deploy.id)
    } catch (err) {
      // 실행하지 못했으면 기록을 지워 같은 요청을 다시 보낼 수 있게 한다.
      await this.store.deleteRun(deploy.id).catch((e: unknown) => this.logger.error(e))
      throw err
    }
    return { deployId: deploy.id, status: 'running' as const, stage: 'build' as const, targetSlot: prepared.slot }
  }

  /**
   * 실행 기록을 저장한다. 같은 프로젝트의 진행 중인 실행이 STALE_RUN_MS 넘게 바뀌지 않았으면 끝난 것으로 보고(파이프라인이 알림을 못 보냈거나
   * `fixing`을 풀어 줄 해결 결과 처리가 아직 없다) TIMED_OUT으로 마감한 뒤 한 번 더 저장한다. 그러지 않으면 한 번 막힌 프로젝트는 영영 시작하지 못한다.
   */
  private async insertOrExpireStale(row: Parameters<DeploysStore['insertRun']>[0]): Promise<void> {
    try {
      await this.store.insertRun(row)
    } catch (err) {
      if (!(err instanceof StoreConflict) || err.constraint.includes('deploy_runs_pkey')) throw err
      const active = await this.store.findActiveRun(row.slug)
      if (active && Date.now() - Date.parse(active.updated_at) < STALE_RUN_MS) throw err
      if (active) {
        await this.store.updateRun(
          active.deploy_id,
          { status: active.status },
          { status: 'failed', failure: { code: 'TIMED_OUT', stage: active.stage ?? 'build', service: null } },
        )
      }
      await this.store.insertRun(row)
    }
  }

  async status(user: AuthUser, id: string): Promise<DeployStatusView> {
    // 소유 확인과 실행 기록 읽기는 서로 기다리지 않는다. 남의 배포면 읽은 기록은 버리고 404다.
    const uuid = parseUuid(id)
    const [deploy, run] = await Promise.all([this.owned(user, id), uuid ? this.store.findRun(uuid) : undefined])
    return view(deploy, run)
  }

  async list(user: AuthUser, rawLimit: unknown) {
    const limit = parseLimit(rawLimit)
    const deploys = await this.store.listOwned(user.id, limit)
    const runs = new Map((await this.store.findRuns(deploys.map((d) => d.id))).map((r) => [r.deploy_id, r]))
    return {
      deploys: deploys.map((d) => {
        const v = view(d, runs.get(d.id))
        return { id: d.id, repo: d.repo, slug: d.slug, commit: d.commit_sha, createdAt: iso(d.created_at), status: v.status, stage: v.stage, url: v.url }
      }),
    }
  }

  /** 파이프라인이 배포 입력을 읽어 간다(기계용 토큰 라우트). */
  async pipelineInput(id: string) {
    const uuid = parseUuid(id)
    const run = uuid ? await this.store.findRun(uuid) : undefined
    if (!run) throw notFound()
    return { deployId: run.deploy_id, slot: run.target_slot, input: run.input }
  }

  /** 파이프라인의 스테이지 알림. 지금 스테이지가 아니거나 이미 끝난 배포의 알림은 아무것도 바꾸지 않는다(재전송에 안전). */
  async notify(body: unknown): Promise<{ ok: true; applied: boolean }> {
    const checked = validateNotice(body)
    if (!checked.ok) throw badNotice('Notice has invalid fields', checked.issues)
    const { notice } = checked
    const run = await this.store.findRun(notice.deployId)
    if (!run) throw notFound()
    if (run.status !== 'running' || run.stage !== notice.stage) return { ok: true, applied: false }
    const applied = notice.result === 'passed' ? await this.passed(run, notice) : await this.failed(run, notice)
    return { ok: true, applied }
  }

  private async passed(run: DeployRunRow, notice: Extract<Notice, { result: 'passed' }>): Promise<boolean> {
    const where = { status: 'running', stage: notice.stage } as const
    if (notice.stage === 'build') {
      const issues = checkImages(conditionsOf(run), notice.images!)
      if (issues.length > 0) throw badNotice('Images do not match the services that were built', issues)
      return this.store.updateRun(run.deploy_id, where, { stage: 'prepare', images: notice.images })
    }
    const next = nextStage(notice.stage)
    if (next !== null) return this.store.updateRun(run.deploy_id, where, { stage: next })

    // switch까지 성공했다(W7): 빌드 캐시 → live 슬롯 → 완료 순서. 중간에 끊겨도 같은 알림을 다시 받으면 같은 결과다.
    const conditions = conditionsOf(run)
    await this.store.cacheImages(
      Object.entries(conditions).flatMap(([service, c]) => {
        // images에는 빌드한(run) 서비스만 있다(알림을 받을 때 checkImages가 확인했다).
        const image = run.images?.[service]
        return image ? [{ slug: run.slug, service, build_input_hash: c.buildInputHash, image }] : []
      }),
    )
    await this.store.setLiveSlot(run.slug, run.target_slot)
    return this.store.updateRun(run.deploy_id, where, { status: 'succeeded', stage: null })
  }

  private async failed(run: DeployRunRow, notice: Extract<Notice, { result: 'failed' }>): Promise<boolean> {
    const where = { status: 'running', stage: notice.stage } as const
    const { failure } = notice
    const { code, callAgent } = classifyFailure(notice.stage, failure.platformCode)
    const stored = { code, stage: notice.stage, service: failure.service }
    if (!callAgent) return this.store.updateRun(run.deploy_id, where, { status: 'failed', failure: stored })

    // 티켓을 보내기 전에 상태를 먼저 바꾼다: 같은 알림이 겹쳐 와도 하나만 통과해 티켓이 두 번 가지 않는다.
    const ticketId = `t_${randomBytes(6).toString('hex')}`
    const gatewayToken = `gw_${randomBytes(24).toString('base64url')}`
    const expiresAt = new Date(Date.now() + TICKET_MINUTES * 60_000)
    const claimed = await this.store.updateRun(run.deploy_id, where, {
      status: 'fixing',
      failure: stored,
      ticket_id: ticketId,
      gateway_token_hash: createHash('sha256').update(gatewayToken).digest('hex'),
      gateway_expires_at: expiresAt.toISOString(),
    })
    if (!claimed) return false

    // 여기부터 무엇이 던져도 "fixing"에 갇히지 않게 실패로 마감한다.
    let sent = false
    try {
      sent = await this.sendTicket(run, notice, ticketId, gatewayToken, expiresAt)
    } catch (err) {
      this.logger.error(err)
    }
    if (!sent) {
      await this.store.updateRun(run.deploy_id, { status: 'fixing' }, { status: 'failed', failure: { ...stored, code: 'AGENT_UNAVAILABLE' } })
    }
    return true
  }

  /** 외부로 나가는 값을 가려 문제 티켓을 만들어 AI 서버에 보낸다. 받았으면 true. */
  private async sendTicket(
    run: DeployRunRow,
    notice: Extract<Notice, { result: 'failed' }>,
    ticketId: string,
    gatewayToken: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const { failure } = notice
    // 이 함수는 티켓으로 가는 실패에서만 불린다(classifyFailure → callAgent). 그때 validateNotice가 증거를 채워 둔다.
    const { raw, logs: given } = failure.evidence!
    const now = new Date().toISOString()
    const logs = given ?? { from: now, to: now, lines: [] }
    // 외부(AI 서버 · 외부 추론 API)로 나가는 값은 모두 비밀값 필터를 거친다(FR-102).
    const ticket = redact({
      ticketId,
      commitSha: (run.input as { commitSha: string }).commitSha,
      stage: notice.stage,
      service: failure.service,
      targetSlot: run.target_slot,
      deployInput: run.input,
      errorMessage: redactString(failure.message),
      raw,
      logs,
      previous: null,
    }) as Record<string, unknown>

    return this.agent.sendTicket({ ticket, gateway: { token: gatewayToken, expiresAt: expiresAt.toISOString() } })
  }
}

const alreadyStarted = () => new ConflictException({ code: 'ALREADY_STARTED', message: 'This deploy was already started' })
const inProgress = () => new ConflictException({ code: 'DEPLOY_IN_PROGRESS', message: 'Another deploy of this project is in progress' })
const badNotice = (message: string, fields: { path: string; code: string }[]) =>
  new BadRequestException({ code: 'BAD_REQUEST', message, fields })

// 시작 때 만든 입력이라 모양은 믿는다(저장하기 전에 validateServiceConditions를 거친다).
const conditionsOf = (run: DeployRunRow) => (run.input.deploy_condition as { services: ServiceConditions }).services

function parseLimit(raw: unknown): number {
  if (raw === undefined) return DEFAULT_LIMIT
  const n = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN
  if (!(n >= 1 && n <= MAX_LIMIT)) throw new BadRequestException({ code: 'INVALID_LIMIT', message: `limit must be an integer from 1 to ${MAX_LIMIT}` })
  return n
}
