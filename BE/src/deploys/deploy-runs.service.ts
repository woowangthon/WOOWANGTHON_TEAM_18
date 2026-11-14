import { createHash, randomBytes } from 'node:crypto'
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import type { AuthUser } from '../auth/auth.decorators.js'
import { isRecord } from '../common/is-record.js'
import { parseUuid } from '../common/uuid.js'
import { redact, redactString } from '../common/redact.js'
import { ClusterCapacity } from '../k8s/cluster-capacity.js'
import { ClusterReader, newestPod } from '../k8s/cluster-reader.js'
import { SpaceService } from '../k8s/space.service.js'
import type { DeployWarning } from '../security/findings.js'
import { SecurityScanService } from '../security/security-scan.service.js'
import { AgentClient } from './agent.client.js'
import { type ServiceConditions, targetSlot } from './deploy-condition.js'
import { DeployPreparer } from './deploy-preparer.js'
import {
  buildSteps,
  checkImages,
  classifyFailure,
  commitOf,
  type DeployStatus,
  type Failure,
  MAX_TICKETS,
  nextStage,
  type Notice,
  publicUrl,
  type Stage,
  type StepKey,
  type StepState,
  ticketCount,
  toFailure,
  validateNotice,
} from './deploy-run.js'
import { DeployQueue } from './deploy-queue.js'
import { type DeployRow, type DeployRunRow, DeploysStore, StoreConflict } from './deploys.store.js'
import { SlotScaleDown } from './slot-scale-down.js'

const TICKET_MINUTES = 15
// 문제 티켓의 로그를 BE가 대상 슬롯 Pod에서 읽을 때(apply · verify): 최근 10분, 마지막 200줄. 알림 요청(파이프라인 제한 10초) 안에서
// 동기로 보내므로 읽기 전체에 상한을 둔다. 넘거나 실패하면 빈 로그로 티켓을 그대로 보낸다.
const TICKET_LOG_SECONDS = 600
const TICKET_LOG_LINES = 200
const TICKET_LOG_TIMEOUT_MS = 3_000
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
  agent: AgentView | null
  url: string | null
  warnings: DeployWarning[]
  /** 배포 대기(`queued`)일 때만. position은 앞에 있는 배포 수(먼저 기다리는 배포 + 지금 도는 배포), waitingForRoom은 클러스터에 자리가 없어 기다리는 중. */
  queue: { position: number; waitingForRoom: boolean } | null
  updatedAt: string
}

/** AI 에이전트의 해결 결과 중 학생에게 보일 칸(api.md "진행 상태 읽기"의 `agent`). */
export interface AgentView {
  status: string
  summary: string
  userRequest: { message: string; secretKeys: string[] } | null
  prUrl: string | null
  evidence: { ref: string | null; text: string | null }[]
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** 게이트웨이가 검사하고 저장한 값이다. 빠진 칸만 빈 값으로 읽는다. */
function toAgent(stored: Record<string, unknown>): AgentView {
  const u = isRecord(stored.userRequest) ? stored.userRequest : null
  const pr = isRecord(stored.pr) ? stored.pr : null
  return {
    status: str(stored.status) ?? 'gave_up',
    summary: str(stored.summary) ?? '',
    userRequest: u ? { message: str(u.message) ?? '', secretKeys: Array.isArray(u.secretKeys) ? (u.secretKeys as unknown[]).filter((k): k is string => typeof k === 'string') : [] } : null,
    prUrl: pr ? str(pr.url) : null,
    evidence: Array.isArray(stored.evidence) ? (stored.evidence as unknown[]).filter(isRecord).map((e) => ({ ref: str(e.ref), text: str(e.text) })) : [],
  }
}

const iso = (t: string) => new Date(t).toISOString()

/** 실행 기록(없을 수 있다)에서 읽기 응답을 만든다. 원본 · 로그 · 비밀값은 저장하지 않으므로 여기 올 수 없다. */
function view(deploy: DeployRow, run: DeployRunRow | undefined, warnings: DeployWarning[] = [], queue: DeployStatusView['queue'] = null): DeployStatusView {
  const status: DeployStatus = run?.status ?? 'not_started'
  const stage = run?.stage ?? null
  return {
    deployId: deploy.id,
    status,
    stage,
    steps: buildSteps(status, stage),
    failure: run?.failure ? toFailure(run.failure) : null,
    agent: run?.agent_result ? toAgent(run.agent_result) : null,
    url: status === 'succeeded' ? publicUrl(deploy.slug) : null,
    // 보안 검사 경고(#45). 목록은 이 칸을 쓰지 않아 비워 둔다.
    warnings,
    queue,
    updatedAt: iso(run?.updated_at ?? deploy.created_at),
  }
}

@Injectable()
export class DeployRunsService {
  private readonly logger = new Logger(DeployRunsService.name)

  constructor(
    private readonly store: DeploysStore,
    private readonly preparer: DeployPreparer,
    private readonly agent: AgentClient,
    private readonly slots: SlotScaleDown,
    private readonly scans: SecurityScanService,
    private readonly reader: ClusterReader,
    private readonly queue: DeployQueue,
    private readonly capacity: ClusterCapacity,
    private readonly space: SpaceService,
  ) {}

  /** 내 배포 하나. 없는 id · 남의 id · UUID가 아닌 id는 모두 404다. */
  private async owned(user: AuthUser, id: string): Promise<DeployRow> {
    const uuid = parseUuid(id)
    const row = uuid ? await this.store.findOwned(uuid, user.id) : undefined
    if (!row) throw notFound()
    return row
  }

  /**
   * 배포 입력으로 실행 기록을 만들어 대기열에 세운다(`queued`). 차례가 오면 대기열(DeployQueue)이 파이프라인을 한 번 실행한다.
   * 확인 순서는 docs/design/api.md "배포 시작". 클러스터에 자리가 없으면 줄을 세우지 않고 409 CLUSTER_FULL이다.
   */
  async start(user: AuthUser, id: string) {
    const deploy = await this.owned(user, id)
    if (await this.store.findRun(deploy.id)) throw alreadyStarted()
    if (await this.capacity.isFull()) throw clusterFull()
    // 준비 안 됨(409 NOT_READY)은 여기서 던져진다.
    const prepared = await this.preparer.prepareIfReady(deploy.id)
    // 공간은 비밀값을 쓸 때만 만들어졌다. 비밀값이 없는 프로젝트도 실행기가 배포할 수 있게 여기서 확인한다(이미 있으면 성공, 실패하면 503).
    await this.space.ensureSpace(deploy.slug)
    const row = {
      deploy_id: deploy.id,
      user_id: user.id,
      slug: deploy.slug,
      target_slot: prepared.slot,
      input: prepared.input as unknown as Record<string, unknown>,
      status: 'queued',
      stage: 'build',
    } as const
    try {
      await this.insertOrExpireStale(row)
    } catch (err) {
      if (!(err instanceof StoreConflict)) throw err
      // 같은 deploy_id(기본 키)면 이미 시작한 배포, 아니면 같은 프로젝트의 다른 배포가 줄에 있거나 도는 중이다.
      throw err.constraint.includes('deploy_runs_pkey') ? alreadyStarted() : inProgress()
    }
    this.queue.kick()
    await this.queue.idle()
    const run = (await this.store.findRun(deploy.id))!
    if (run.status === 'failed' && run.failure?.code === 'PIPELINE_UNAVAILABLE') {
      // 파이프라인을 부르지 못했으면 기록을 지워 같은 요청을 다시 보낼 수 있게 한다.
      await this.store.deleteRun(deploy.id).catch((e: unknown) => this.logger.error(e))
      throw pipelineUnavailable()
    }
    return { deployId: deploy.id, status: run.status, stage: run.stage, targetSlot: prepared.slot }
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
      if (active && (Date.now() - Date.parse(active.updated_at) < STALE_RUN_MS || isWorkingTicket(active))) throw err
      if (active) await this.queue.expire(active)
      await this.store.insertRun(row)
    }
  }

  async status(user: AuthUser, id: string): Promise<DeployStatusView> {
    // 소유 확인과 실행 기록 읽기는 서로 기다리지 않는다. 남의 배포면 읽은 기록은 버리고 404다.
    const uuid = parseUuid(id)
    const [deploy, run] = await Promise.all([this.owned(user, id), uuid ? this.store.findRun(uuid) : undefined])
    const queue = run?.status === 'queued' ? await this.queueView(run) : null
    return view(deploy, run, await this.scans.warningsFor(deploy), queue)
  }

  private async queueView(run: DeployRunRow): Promise<NonNullable<DeployStatusView['queue']>> {
    const [position, waitingForRoom] = await Promise.all([this.store.lineAhead(run), this.capacity.isFull()])
    return { position, waitingForRoom }
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
    // 이 실행이 running을 벗어났다(succeeded · failed · fixing): 다음 차례를 출발시킨다.
    this.queue.kick()
    return { ok: true, applied }
  }

  private async passed(run: DeployRunRow, notice: Extract<Notice, { result: 'passed' }>): Promise<boolean> {
    const where = { status: 'running', stage: notice.stage } as const
    if (notice.stage === 'build') {
      const issues = checkImages(conditionsOf(run), notice.images!)
      if (issues.length > 0) throw badNotice('Images do not match the services that were built', issues)
      // 같은 빌드 입력 해시는 같은 이미지라 뒤 스테이지가 실패해도 재사용해도 된다(api.md 3번). 같은 알림을 다시 받아도 같은 결과다.
      // verified 뒤 다시 실행은 모두 reuse라 images가 {}이고 run.images도 {}로 덮인다. 그 뒤 이미지는 input.deploy_condition.services[*].image에서 읽어야 한다.
      await this.store.cacheImages(
        Object.entries(conditionsOf(run)).flatMap(([service, c]) => {
          // images에는 빌드한(run) 서비스만 있다(위 checkImages가 확인했다).
          const image = notice.images![service]
          return image ? [{ slug: run.slug, service, build_input_hash: c.buildInputHash, image }] : []
        }),
      )
      return this.store.updateRun(run.deploy_id, where, { stage: 'prepare', images: notice.images })
    }
    const next = nextStage(notice.stage)
    if (next !== null) return this.store.updateRun(run.deploy_id, where, { stage: next })

    // switch까지 성공했다(W7): live 슬롯 → 이전 슬롯 내리기 → 완료 순서. 중간에 끊겨도 같은 알림을 다시 받으면 같은 결과다.
    // 이전 live 슬롯은 live 슬롯을 바꾸기 전에 읽는다(첫 배포는 없다).
    const hadLive = (await this.store.liveSlot(run.slug)) !== null
    await this.store.setLiveSlot(run.slug, run.target_slot)
    // 주소는 이미 바뀌었다. 이전 슬롯을 못 내려도 배포는 성공이다.
    if (hadLive) await this.slots.scaleDown(run.slug, targetSlot(run.target_slot))
    const done = await this.store.updateRun(run.deploy_id, where, { status: 'succeeded', stage: null })
    // verified 뒤 다시 실행이 성공했다(api.md 5번). 받지 못해도 배포는 이미 끝났다.
    if (done && run.ticket_id) await this.agent.close(run.ticket_id, commitOf(run), 'success')
    return done
  }

  private async failed(run: DeployRunRow, notice: Extract<Notice, { result: 'failed' }>): Promise<boolean> {
    const where = { status: 'running', stage: notice.stage } as const
    const { failure } = notice
    const { code, callAgent } = classifyFailure(notice.stage, failure.platformCode)
    const stored = { code, stage: notice.stage, service: failure.service }
    if (!callAgent) {
      const done = await this.store.updateRun(run.deploy_id, where, { status: 'failed', failure: stored })
      if (done) await this.slots.afterFailure(run, notice.stage)
      // verified 뒤 다시 실행이 플랫폼 문제로 끝났다. 앞 티켓의 에이전트에 멈추라고 알린다.
      if (done && run.ticket_id) await this.agent.close(run.ticket_id, commitOf(run), 'stopped')
      return done
    }
    // 다시 실행이 또 실패했는데 티켓을 이미 실행 기록당 상한만큼 냈다: 새 티켓 없이 마감한다.
    if (ticketCount(run) > MAX_TICKETS) {
      const done = await this.store.updateRun(run.deploy_id, where, { status: 'failed', failure: { ...stored, code: 'AGENT_GAVE_UP' } })
      if (done) await this.slots.afterFailure(run, notice.stage)
      if (done && run.ticket_id) await this.agent.close(run.ticket_id, commitOf(run), 'stopped')
      return done
    }

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
    // verified 뒤 다시 실행이 또 실패했다: 앞 티켓은 새 티켓으로 바뀐다(api.md 5번).
    if (run.ticket_id) await this.agent.close(run.ticket_id, commitOf(run), 'superseded')

    // 여기부터 무엇이 던져도 "fixing"에 갇히지 않게 실패로 마감한다.
    let sent = false
    try {
      sent = await this.sendTicket(run, notice, ticketId, gatewayToken, expiresAt)
    } catch (err) {
      this.logger.error(err)
    }
    if (!sent) {
      const done = await this.store.updateRun(run.deploy_id, { status: 'fixing' }, { status: 'failed', failure: { ...stored, code: 'AGENT_UNAVAILABLE' } })
      if (done) await this.slots.afterFailure(run, notice.stage)
    }
    return true
  }

  /**
   * 문제 티켓의 로그(api.md 3번 `failure.logs`): 대상 슬롯의 그 서비스 Pod 중 가장 최근 것(게이트웨이 `read_pod_logs`와 같은 Pod)의 최근 10분, 마지막 200줄.
   * 컨테이너가 재시작했으면 직전 컨테이너(죽은 쪽)의 로그다. 줄마다 비밀값 필터를 거친다. Pod가 없으면 빈 줄,
   * 읽지 못하거나 상한(3초)을 넘으면 null(부른 쪽이 빈 로그로 보낸다. 로그 때문에 티켓이 늦거나 빠지지 않는다).
   */
  private async slotLogs(run: DeployRunRow, service: string): Promise<{ from: string; to: string; lines: string[] } | null> {
    const to = new Date()
    const from = new Date(to.getTime() - TICKET_LOG_SECONDS * 1000)
    const read = async () => {
      const pod = newestPod(await this.reader.rawObjects(run.slug, 'pods', `app=${service},slot=${run.target_slot}`))
      if (!pod) return []
      const text = await this.reader.logs(run.slug, pod.name, { container: service, tailLines: TICKET_LOG_LINES, previous: pod.restarts > 0, sinceSeconds: TICKET_LOG_SECONDS })
      return lines(text).slice(-TICKET_LOG_LINES).map(redactString)
    }
    // 상한을 넘긴 뒤 읽기가 늦게 실패해도 처리되지 않은 거절이 남지 않게 여기서 받는다. 값(로그 · 원본)은 남기지 않는다.
    const reading = read().catch((err: unknown) => {
      this.logger.error(`ticket logs: could not read ${run.slug} ${service}: ${err instanceof Error ? err.name : 'unknown'}`)
      return 'failed' as const
    })
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), TICKET_LOG_TIMEOUT_MS)
    })
    const got = await Promise.race([reading, timeout])
    clearTimeout(timer)
    if (got === 'timeout') this.logger.error(`ticket logs: no answer from the cluster in ${TICKET_LOG_TIMEOUT_MS} ms for ${run.slug} ${service}`)
    return typeof got === 'string' ? null : { from: from.toISOString(), to: to.toISOString(), lines: got }
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
    // 파이프라인이 로그를 보냈으면 그것을 쓴다. apply · verify에서 줄이 없으면(실행기에 Pod 로그 권한이 없다) 대상 슬롯 Pod에서 읽는다.
    const read = !given?.lines.length && (notice.stage === 'apply' || notice.stage === 'verify') && failure.service ? await this.slotLogs(run, failure.service) : null
    const logs = read ?? given ?? { from: now, to: now, lines: [] }
    // 외부(AI 서버 · 외부 추론 API)로 나가는 값은 모두 비밀값 필터를 거친다(FR-102).
    const ticket = redact({
      ticketId,
      commitSha: commitOf(run),
      stage: notice.stage,
      service: failure.service,
      targetSlot: run.target_slot,
      deployInput: run.input,
      errorMessage: redactString(failure.message),
      raw,
      logs,
      previous: previousTicket(run),
    }) as Record<string, unknown>

    return this.agent.sendTicket({ ticket, gateway: { token: gatewayToken, expiresAt: expiresAt.toISOString() } })
  }
}

const lines = (text: string) => text.split('\n').filter((line, i, all) => !(i === all.length - 1 && line === ''))

const alreadyStarted = () => new ConflictException({ code: 'ALREADY_STARTED', message: 'This deploy was already started' })
const clusterFull = () => new ConflictException({ code: 'CLUSTER_FULL', message: 'The cluster has no room for a new deploy right now' })
const pipelineUnavailable = () => new ServiceUnavailableException({ code: 'PIPELINE_UNAVAILABLE', message: 'Could not start the deploy pipeline' })
const inProgress = () => new ConflictException({ code: 'DEPLOY_IN_PROGRESS', message: 'Another deploy of this project is in progress' })
const badNotice = (message: string, fields: { path: string; code: string }[]) =>
  new BadRequestException({ code: 'BAD_REQUEST', message, fields })

// 에이전트가 시험 실행을 기다리는 티켓은 1시간 넘게 알림이 없어도 멈춘 것이 아니다. 토큰 만료(티켓 전체 상한 60분 안)가 지나면 평소대로 판정한다.
const isWorkingTicket = (run: DeployRunRow) => run.status === 'fixing' && run.gateway_expires_at !== null && Date.parse(run.gateway_expires_at) > Date.now()

/** 새 티켓의 `previous`: 이 실행 기록의 앞 티켓(verified 뒤 다시 실행이 실패했을 때). 없으면 null. */
function previousTicket(run: DeployRunRow): { ticketId: string; status: string; summary: string } | null {
  if (!run.ticket_id) return null
  const r = run.agent_result
  return { ticketId: run.ticket_id, status: typeof r?.status === 'string' ? r.status : 'stopped', summary: typeof r?.summary === 'string' ? r.summary : '' }
}

// 시작 때 만든 입력이라 모양은 믿는다(저장하기 전에 validateServiceConditions를 거친다).
const conditionsOf = (run: DeployRunRow) => (run.input.deploy_condition as { services: ServiceConditions }).services

function parseLimit(raw: unknown): number {
  if (raw === undefined) return DEFAULT_LIMIT
  const n = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN
  if (!(n >= 1 && n <= MAX_LIMIT)) throw new BadRequestException({ code: 'INVALID_LIMIT', message: `limit must be an integer from 1 to ${MAX_LIMIT}` })
  return n
}
