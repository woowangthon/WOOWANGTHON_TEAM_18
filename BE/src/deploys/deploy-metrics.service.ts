import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../auth/auth.decorators.js'
import { parseUuid } from '../common/uuid.js'
import { ClusterReader } from '../k8s/cluster-reader.js'
import { errorKind, ownsPod, readUsageByPod, type ServiceSeries, serviceUsage, seriesByService, type Usage } from '../k8s/service-metrics.js'
import { DeploysStore } from './deploys.store.js'

const WINDOW_SECONDS = 3600
const STEP_SECONDS = 60

type NotLiveReason = 'not_succeeded' | 'superseded'
type ServiceState = 'running' | 'starting' | 'stopped'

export interface MetricsService {
  name: string
  deployment: string
  state: ServiceState
  waiting: string | null
  replicas: number
  readyReplicas: number
  restarts: number
  usage: Usage | null
}

export type MetricsView =
  | { deployId: string; slug: string; state: 'not_live'; reason: NotLiveReason; slot: null; services: []; usageStatus: null; series: null }
  | {
      deployId: string
      slug: string
      state: 'live'
      reason: null
      slot: 'a' | 'b'
      services: MetricsService[]
      usageStatus: 'collected' | 'not_collected'
      series:
        | { status: 'collected'; endT: number; windowSeconds: number; stepSeconds: number; services: ServiceSeries[] }
        | { status: 'not_collected'; endT: number; windowSeconds: number; stepSeconds: number; services: [] }
    }

const notFound = () => new NotFoundException({ code: 'DEPLOY_NOT_FOUND', message: 'No such deploy' })

/**
 * 학생 본인 배포의 서비스별 실행 지표(api.md "내 서비스의 실행 지표"). 읽기만 한다.
 * 지금 공개 중인 배포(프로젝트의 마지막 성공 실행)일 때만 live 슬롯의 Deployment · Pod를 읽는다.
 */
@Injectable()
export class DeployMetricsService {
  private readonly logger = new Logger(DeployMetricsService.name)

  constructor(
    private readonly store: DeploysStore,
    private readonly reader: ClusterReader,
  ) {}

  /** `nowMs`는 시험에서 시계를 고정하려는 것이다. */
  async get(user: AuthUser, id: string, nowMs = Date.now()): Promise<MetricsView> {
    const uuid = parseUuid(id)
    const deploy = uuid ? await this.store.findOwned(uuid, user.id) : undefined
    if (!deploy) throw notFound()
    const { slug } = deploy
    const notLive = (reason: NotLiveReason): MetricsView => ({ deployId: deploy.id, slug, state: 'not_live', reason, slot: null, services: [], usageStatus: null, series: null })

    const [run, last, slot] = await Promise.all([this.store.findRun(deploy.id), this.store.findLastSucceededRun(slug), this.store.liveSlot(slug)])
    if (run?.status !== 'succeeded') return notLive('not_succeeded')
    if (last?.deploy_id !== deploy.id) return notLive('superseded')
    // 성공으로 끝났는데 live 슬롯이 아직 없는 것은 전환 기록이 따라오는 사이다. 읽을 슬롯이 없어 값을 주지 않는다.
    if (slot === null) return notLive('not_succeeded')

    // 목록을 읽지 못하면 ClusterError가 그대로 나가 503 CLUSTER_UNAVAILABLE이다(학생에게 권한 같은 이유를 나누지 않는다).
    const [deployments, pods] = await Promise.all([this.reader.deployments(slug), this.reader.pods(slug)])
    const live = deployments.filter((d) => d.name.endsWith(`-${slot}`))
    const services = live.map((d) => ({ name: d.name.slice(0, -`-${slot}`.length), deployment: d.name, d }))

    const [usages, series] = await Promise.all([readUsageByPod(this.reader, this.logger, slug), this.series(slug, services, nowMs)])
    return {
      deployId: deploy.id,
      slug,
      state: 'live',
      reason: null,
      slot,
      services: services.map(({ name, deployment, d }) => {
        const own = pods.filter((p) => ownsPod(deployment, p.name))
        const state: ServiceState = d.replicas === 0 ? 'stopped' : d.ready >= d.replicas ? 'running' : 'starting'
        return {
          name,
          deployment,
          state,
          waiting: state === 'starting' ? (own.find((p) => p.waiting !== null)?.waiting ?? null) : null,
          replicas: d.replicas,
          readyReplicas: d.ready,
          restarts: own.reduce((sum, p) => sum + p.restarts, 0),
          usage: serviceUsage(own.map((p) => p.name), usages),
        }
      }),
      usageStatus: usages === null ? 'not_collected' : 'collected',
      series,
    }
  }

  /** 최근 1시간 시계열. CPU · 메모리 중 하나라도 읽지 못하면 일부만 보이지 않게 둘 다 not_collected다. */
  private async series(slug: string, services: { name: string; deployment: string }[], nowMs: number) {
    const end = Math.floor(nowMs / 1000)
    const range = { start: end - WINDOW_SECONDS, end, step: STEP_SECONDS }
    try {
      const [cpu, memory] = await Promise.all([this.reader.podRangeSeries(slug, 'cpu', range), this.reader.podRangeSeries(slug, 'memory', range)])
      return { status: 'collected' as const, endT: end, windowSeconds: WINDOW_SECONDS, stepSeconds: STEP_SECONDS, services: seriesByService(services, cpu, memory) }
    } catch (err) {
      this.logger.warn(`Pod series not read: ${errorKind(err)}`)
      return { status: 'not_collected' as const, endT: end, windowSeconds: WINDOW_SECONDS, stepSeconds: STEP_SECONDS, services: [] as [] }
    }
  }
}
