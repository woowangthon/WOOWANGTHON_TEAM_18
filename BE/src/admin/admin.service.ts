import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import type { AuthUser } from '../auth/auth.decorators.js'
import { SLUG } from '../deploys/deploy-input.js'
import { publicUrl } from '../deploys/deploy-run.js'
import { ClusterError } from '../k8s/cluster-error.js'
import { ClusterReader, type NodeInfo, type NodeUsageInfo, type PodInfo } from '../k8s/cluster-reader.js'
import { DeploymentScaler } from '../k8s/deployment-scaler.js'
import { ownsPod, readUsageByPod, serviceUsage } from '../k8s/service-metrics.js'
import { AdminStore, type ProjectRecord, type StopRecord } from './admin.store.js'
import { bytes, millicores } from './quantity.js'

// 클러스터가 알려 준 Deployment 이름도 경로에 넣기 전에 DNS 이름 모양인지 본다.
const K8S_NAME = /^[a-z0-9]([-a-z0-9]{0,251}[a-z0-9])?$/

const unreachable = () => new ServiceUnavailableException({ code: 'CLUSTER_UNREACHABLE', message: 'Could not reach the cluster' })
const forbidden = () =>
  new ServiceUnavailableException({ code: 'CLUSTER_FORBIDDEN', message: 'The server account is not allowed to do this in the cluster' })
const projectNotFound = () => new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: 'No such project' })

/** 클러스터 호출의 실패를 사용자에게 알리는 오류로: 닿았는데 권한이 없으면 FORBIDDEN, 그 밖은 UNREACHABLE. */
function asHttp(err: unknown): unknown {
  if (err instanceof ClusterError) return err.kind === 'forbidden' || err.kind === 'unauthorized' ? forbidden() : unreachable()
  return err
}

export interface NodeView {
  name: string
  ready: boolean
  role: 'leader' | 'worker'
  cpu: { capacityMillicores: number | null; allocatableMillicores: number | null }
  memory: { capacityBytes: number | null; allocatableBytes: number | null }
  disk: { capacityBytes: number | null; allocatableBytes: number | null }
  /** 사용량을 읽지 못했거나 이 노드가 아직 수집 전이면 null */
  usage: { cpuMillicores: number; memoryBytes: number } | null
}

function toUsage(usage: NodeUsageInfo['usage'] | undefined): NodeView['usage'] {
  const cpuMillicores = millicores(usage?.cpu)
  const memoryBytes = bytes(usage?.memory)
  // 한 칸이라도 읽을 수 없으면 값을 지어내지 않는다.
  return cpuMillicores === null || memoryBytes === null ? null : { cpuMillicores, memoryBytes }
}

function toNode({ name, ready, roles, capacity, allocatable }: NodeInfo, usage: NodeUsageInfo['usage'] | undefined): NodeView {
  return {
    name,
    ready,
    role: roles.includes('control-plane') || roles.includes('master') ? 'leader' : 'worker',
    cpu: { capacityMillicores: millicores(capacity.cpu), allocatableMillicores: millicores(allocatable.cpu) },
    memory: { capacityBytes: bytes(capacity.memory), allocatableBytes: bytes(allocatable.memory) },
    disk: { capacityBytes: bytes(capacity['ephemeral-storage']), allocatableBytes: bytes(allocatable['ephemeral-storage']) },
    usage: toUsage(usage),
  }
}

export const STATUS_FILTERS = ['all', 'running', 'stopped'] as const
const MAX_PAGE_SIZE = 50
const MAX_SEARCH = 100
const invalidQuery = (message: string) => new BadRequestException({ code: 'INVALID_QUERY', message })

/** `?page=&pageSize=&q=&status=`. 없으면 1 · 10 · 검색 없음 · all. 그 밖의 값은 400 INVALID_QUERY다. */
function parseProjectsQuery(raw: Record<string, unknown>) {
  const int = (name: string, fallback: number, max: number) => {
    const v = raw[name]
    if (v === undefined) return fallback
    if (typeof v !== 'string' || !/^[0-9]{1,6}$/.test(v) || Number(v) < 1 || Number(v) > max) throw invalidQuery(`${name} must be an integer from 1 to ${max}`)
    return Number(v)
  }
  const q = raw.q === undefined ? '' : raw.q
  if (typeof q !== 'string' || [...q.trim()].length > MAX_SEARCH) throw invalidQuery(`q must be at most ${MAX_SEARCH} characters`)
  const status = raw.status === undefined ? 'all' : raw.status
  if (!STATUS_FILTERS.some((f) => f === status)) throw invalidQuery('status must be all, running or stopped')
  return { page: int('page', 1, 1_000_000), pageSize: int('pageSize', 10, MAX_PAGE_SIZE), q: q.trim(), status: status as (typeof STATUS_FILTERS)[number] }
}

/** 화면(ProjectCard)과 같은 뜻. 읽지 못했으면 둘 다 아니고, 서비스가 없거나 모두 0개면 stopped(끌 것이 없다)다. */
const runState = ({ services, clusterError }: ProjectView): 'running' | 'stopped' | 'unknown' =>
  clusterError ? 'unknown' : services.length === 0 || services.every((s) => s.replicas === 0) ? 'stopped' : 'running'

type ServicesRead = Awaited<ReturnType<AdminService['services']>>
interface ProjectView extends ServicesRead {
  slug: string
  repo: string
  ownerId: string
  liveSlot: 'a' | 'b' | null
  url: string | null
  lastStop: StopRecord | null
  clusterError: string | null
}

const toPod = ({ name, phase, ready, node, restarts }: PodInfo) => ({ name, phase, ready, node, restarts })

/**
 * 읽기 결과를 받는다. 실패는 사용자에게 알리는 오류로 바꾸고, `goneIsEmpty`면 없는 공간은 빈 목록이다.
 * 서버가 만들지 않았거나 지운 공간은 403(`forbidden`)으로 답한다(docs/design/cluster-client.md "오류 나누기"). 404도 같이 본다.
 */
async function readList<T>(read: Promise<T[]>, goneIsEmpty = false): Promise<T[]> {
  try {
    return await read
  } catch (err) {
    if (goneIsEmpty && err instanceof ClusterError && (err.kind === 'forbidden' || err.kind === 'not_found')) return []
    throw asHttp(err)
  }
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name)

  constructor(
    private readonly store: AdminStore,
    private readonly reader: ClusterReader,
    private readonly scaler: DeploymentScaler,
  ) {}

  async nodes() {
    const [infos, usages] = await Promise.all([readList(this.reader.nodes()), this.nodeUsages()])
    // 사용량을 못 읽어도 노드 목록은 보여 준다. 읽었는데 목록에 없는 노드는 첫 수집 전이라 null이다.
    const nodes = infos.map((info) => toNode(info, usages?.get(info.name)))
    return { usageStatus: usages === null ? ('not_collected' as const) : ('collected' as const), nodes }
  }

  /** 노드 이름별 사용량. 읽지 못하면 null(원인은 종류만 로그에 남긴다: 메시지에 값이 있을 수 있다). */
  private async nodeUsages(): Promise<Map<string, NodeUsageInfo['usage']> | null> {
    try {
      return new Map((await this.reader.nodeUsage()).map((u) => [u.name, u.usage]))
    } catch (err) {
      this.logger.warn(`Node usage not read: ${err instanceof ClusterError ? `${err.kind} ${err.apiStatus ?? ''}`.trim() : 'error'}`)
      return null
    }
  }

  /**
   * DB에 배포가 있는 프로젝트(정리한 것은 빼고)를 검색 · 상태로 거르고 쪽으로 나눠, 그 쪽의 프로젝트마다 공간 `proj-<slug>`를 읽는다
   * (서버 계정은 공간 전체를 한 번에 읽을 수 없다). 상태는 클러스터에서만 알 수 있어서, 상태로 거를 때는 검색에 맞는 프로젝트를 모두 읽는다.
   */
  async projects(rawQuery: Record<string, unknown> = {}) {
    const { page, pageSize, q, status } = parseProjectsQuery(rawQuery)
    const [records, stops] = await Promise.all([this.store.projects(), this.store.lastStops()])
    const needle = q.toLowerCase()
    const matched = records.filter((p) => !p.hidden && (needle === '' || p.slug.includes(needle) || p.repo.toLowerCase().includes(needle)))
    const from = (page - 1) * pageSize
    let shown: ProjectView[]
    let total: number
    if (status === 'all') {
      total = matched.length
      shown = await this.readProjects(matched.slice(from, from + pageSize), stops)
    } else {
      const filtered = (await this.readProjects(matched, stops)).filter((p) => runState(p) === status)
      total = filtered.length
      shown = filtered.slice(from, from + pageSize)
    }
    return { projects: shown, page, pageSize, total }
  }

  private async readProjects(records: ProjectRecord[], stops: Map<string, StopRecord>): Promise<ProjectView[]> {
    const read = await Promise.all(
      records.map(async (p: ProjectRecord) => {
        let read: ServicesRead = { services: [], usageStatus: 'not_collected' }
        let error: unknown
        try {
          read = await this.services(p.slug)
        } catch (err) {
          error = err
        }
        return { p, ...read, error }
      }),
    )
    // 모든 프로젝트를 못 읽었으면 리더 문제다(화면이 "리더 무응답"을 보여 줄 수 있게 오류로 알린다). 일부만이면 읽은 것은 보여 주고 못 읽은 것에 표시한다.
    if (read.length > 0 && read.every((r) => r.error !== undefined)) throw read[0].error
    return read.map(({ p, services, usageStatus, error }) => ({
      slug: p.slug,
      repo: p.repo,
      ownerId: p.ownerId,
      liveSlot: p.liveSlot,
      url: p.liveSlot === null ? null : publicUrl(p.slug),
      lastStop: stops.get(p.slug) ?? null,
      usageStatus,
      services,
      clusterError: error === undefined ? null : error instanceof ServiceUnavailableException ? (error.getResponse() as { code: string }).code : 'CLUSTER_UNREACHABLE',
    }))
  }

  /** 프로젝트 공간의 서비스. Pod 사용량을 읽지 못하면 서비스는 그대로 주고 `usage`만 null, `usageStatus`가 not_collected다. */
  private async services(slug: string) {
    // 공간이 아직 없으면 서비스가 없다.
    const [deployments, pods, usages] = await Promise.all([
      readList(this.reader.deployments(slug), true),
      readList(this.reader.pods(slug), true),
      readUsageByPod(this.reader, this.logger, slug),
    ])
    const services = deployments.map(({ name, replicas, ready }) => {
      const own = pods.filter((p) => ownsPod(name, p.name))
      return {
        name,
        slot: /-(a|b)$/.exec(name)?.[1] ?? null,
        replicas,
        readyReplicas: ready,
        restarts: own.reduce((sum, p) => sum + p.restarts, 0),
        usage: serviceUsage(own.map((p) => p.name), usages),
        pods: own.map(toPod),
      }
    })
    return { services, usageStatus: usages === null ? ('not_collected' as const) : ('collected' as const) }
  }

  /** 프로젝트의 Deployment를 모두 replicas 0으로 내리고, 하나라도 내렸으면 누가 했는지 기록한다. */
  async stop(actor: AuthUser, slug: string) {
    if (!SLUG.test(slug) || !(await this.store.projectExists(slug))) throw projectNotFound()
    const deployments = await readList(this.reader.deployments(slug), true)
    const names = deployments.map((d) => d.name).filter((n) => K8S_NAME.test(n))
    if (names.length === 0) throw new ConflictException({ code: 'NOT_RUNNING', message: 'Nothing is running for this project' })

    const results = await Promise.allSettled(
      names.map((name) => this.scaler.scaleToZero(slug, name)),
    )
    const scaled = names.filter((_, i) => results[i].status === 'fulfilled')
    const failed = names.filter((_, i) => results[i].status === 'rejected')
    if (scaled.length === 0) {
      // 하나도 못 내렸다: 권한이 없는 것이 하나라도 있으면 그 이유를, 아니면 닿지 못한 것으로 알린다.
      const reasons = results.flatMap((r): unknown[] => (r.status === 'rejected' ? [r.reason] : []))
      throw asHttp(reasons.find((r) => r instanceof ClusterError && r.kind === 'forbidden') ?? reasons[0])
    }
    // 기록하지 못하면 503이다. 이미 내린 것은 그대로지만 같은 요청을 다시 보내도 안전하다(replicas 0을 다시 쓰고 기록을 남긴다).
    await this.store.recordStop(slug, actor)
    return { slug, scaled, failed }
  }

  /**
   * 중지된 프로젝트를 운영자 목록에서 숨긴다(정리 = 소프트 삭제). 실행 중이면 409 NOT_STOPPED다(먼저 중지해야 한다).
   * 클러스터 객체(Deployment · Service · 네임스페이스 · 이미지)는 지우지 않는다. 정리(GC)는 아직 없다.
   */
  async hide(slug: string) {
    if (!SLUG.test(slug) || !(await this.store.projectExists(slug))) throw projectNotFound()
    const deployments = await readList(this.reader.deployments(slug), true)
    if (deployments.some((d) => d.replicas > 0)) throw new ConflictException({ code: 'NOT_STOPPED', message: 'Stop the project before cleaning it up' })
    await this.store.hide(slug)
    return { slug }
  }
}
