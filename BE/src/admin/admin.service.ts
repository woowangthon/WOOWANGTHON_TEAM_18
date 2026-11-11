import { Injectable, NotFoundException, ConflictException, ServiceUnavailableException } from '@nestjs/common'
import type { AuthUser } from '../auth/auth.decorators.js'
import { isRecord } from '../common/is-record.js'
import { AdminStore, type ProjectRecord } from './admin.store.js'
import { ClusterApi, ClusterApiError } from './cluster.api.js'
import { bytes, millicores } from './quantity.js'

// 요청 경로에 들어가는 값이다. 학생 공간 이름 `proj-<slug>`의 slug 규칙(docs/design/api.md)과 같다.
const SLUG = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/
// 클러스터가 알려 준 Deployment 이름도 경로에 넣기 전에 DNS 이름 모양인지 본다.
const K8S_NAME = /^[a-z0-9]([-a-z0-9]{0,251}[a-z0-9])?$/

const unreachable = () => new ServiceUnavailableException({ code: 'CLUSTER_UNREACHABLE', message: 'Could not reach the cluster' })
const forbidden = () =>
  new ServiceUnavailableException({ code: 'CLUSTER_FORBIDDEN', message: 'The server account is not allowed to do this in the cluster' })
// 학생 공개 주소(docs/design/cluster.md §9).
const publicUrl = (slug: string) => `https://${slug}.stairnoworks.com`
const projectNotFound = () => new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: 'No such project' })

/** 클러스터 호출의 실패를 사용자에게 알리는 오류로. */
function asHttp(err: unknown): unknown {
  if (err instanceof ClusterApiError) return err.kind === 'forbidden' ? forbidden() : unreachable()
  return err
}

const itemsOf = (list: unknown): Record<string, unknown>[] =>
  isRecord(list) && Array.isArray(list.items) ? list.items.filter(isRecord) : []
const rec = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {})
const text = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const int = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isInteger(v) ? v : fallback)

export interface NodeView {
  name: string
  ready: boolean
  role: 'leader' | 'worker'
  cpu: { capacityMillicores: number | null; allocatableMillicores: number | null }
  memory: { capacityBytes: number | null; allocatableBytes: number | null }
  disk: { capacityBytes: number | null; allocatableBytes: number | null }
  usage: null
}

function toNode(item: Record<string, unknown>): NodeView {
  const meta = rec(item.metadata)
  const status = rec(item.status)
  const labels = rec(meta.labels)
  const cap = rec(status.capacity)
  const alloc = rec(status.allocatable)
  const ready = Array.isArray(status.conditions) && status.conditions.some((c) => isRecord(c) && c.type === 'Ready' && c.status === 'True')
  return {
    name: text(meta.name) ?? '',
    ready,
    role: 'node-role.kubernetes.io/control-plane' in labels || 'node-role.kubernetes.io/master' in labels ? 'leader' : 'worker',
    cpu: { capacityMillicores: millicores(cap.cpu), allocatableMillicores: millicores(alloc.cpu) },
    memory: { capacityBytes: bytes(cap.memory), allocatableBytes: bytes(alloc.memory) },
    disk: { capacityBytes: bytes(cap['ephemeral-storage']), allocatableBytes: bytes(alloc['ephemeral-storage']) },
    // 사용량(Prometheus · metrics.k8s.io) 읽기 권한이 아직 없다. 값을 지어내지 않는다.
    usage: null,
  }
}

interface PodView {
  name: string
  phase: string
  ready: boolean
  node: string | null
  restarts: number
}

function toPod(item: Record<string, unknown>): PodView {
  const status = rec(item.status)
  const containers = Array.isArray(status.containerStatuses) ? status.containerStatuses.filter(isRecord) : []
  return {
    name: text(rec(item.metadata).name) ?? '',
    phase: text(status.phase) ?? 'Unknown',
    ready: containers.length > 0 && containers.every((c) => c.ready === true),
    node: text(rec(item.spec).nodeName),
    restarts: containers.reduce((sum, c) => sum + int(c.restartCount, 0), 0),
  }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

@Injectable()
export class AdminService {
  constructor(
    private readonly store: AdminStore,
    private readonly cluster: ClusterApi,
  ) {}

  private async read(path: string): Promise<unknown> {
    try {
      return await this.cluster.get(path)
    } catch (err) {
      throw asHttp(err)
    }
  }

  async nodes() {
    const nodes = itemsOf(await this.read('/api/v1/nodes')).map(toNode)
    return { usageStatus: 'not_collected' as const, nodes }
  }

  /** DB에 배포가 있는 프로젝트마다 공간 `proj-<slug>`를 읽는다(서버 계정은 공간 전체를 한 번에 읽을 수 없다). */
  async projects() {
    const [records, stops] = await Promise.all([this.store.projects(), this.store.lastStops()])
    const projects = await Promise.all(
      records.map(async (p: ProjectRecord) => ({
        slug: p.slug,
        repo: p.repo,
        ownerId: p.ownerId,
        liveSlot: p.liveSlot,
        url: p.liveSlot === null ? null : publicUrl(p.slug),
        lastStop: stops.get(p.slug) ?? null,
        services: await this.services(p.slug),
      })),
    )
    return { projects }
  }

  private async services(slug: string) {
    const ns = `/namespaces/proj-${slug}`
    const [deployments, pods] = await Promise.all([this.read(`/apis/apps/v1${ns}/deployments`), this.read(`/api/v1${ns}/pods`)])
    // 공간이 아직 없으면(404) 서비스가 없다.
    const podViews = itemsOf(pods).map(toPod)
    return itemsOf(deployments).map((d) => {
      const name = text(rec(d.metadata).name) ?? ''
      // Pod 이름은 `<Deployment>-<ReplicaSet 해시>-<5자>`다. `fe`와 `fe-a`처럼 접두사가 겹치는 이름이 섞이지 않게 모양 전체를 본다.
      const owns = new RegExp(`^${escapeRegExp(name)}-[a-z0-9]+-[a-z0-9]{5}$`)
      return {
        name,
        slot: /-(a|b)$/.exec(name)?.[1] ?? null,
        replicas: int(rec(d.spec).replicas, 1),
        readyReplicas: int(rec(d.status).readyReplicas, 0),
        pods: podViews.filter((p) => owns.test(p.name)),
      }
    })
  }

  /** 프로젝트의 Deployment를 모두 replicas 0으로. 요청을 먼저 기록하고(기록하지 못하면 아무것도 내리지 않는다) 내린다. */
  async stop(actor: AuthUser, slug: string) {
    if (!SLUG.test(slug) || !(await this.store.projectExists(slug))) throw projectNotFound()
    const names = itemsOf(await this.read(`/apis/apps/v1/namespaces/proj-${slug}/deployments`))
      .map((d) => text(rec(d.metadata).name))
      .filter((n): n is string => n !== null && K8S_NAME.test(n))
    if (names.length === 0) throw new ConflictException({ code: 'NOT_RUNNING', message: 'Nothing is running for this project' })

    await this.store.recordStop(slug, actor)
    const results = await Promise.allSettled(
      names.map((name) => this.cluster.patch(`/apis/apps/v1/namespaces/proj-${slug}/deployments/${name}/scale`, { spec: { replicas: 0 } })),
    )
    const scaled = names.filter((_, i) => results[i].status === 'fulfilled')
    const failed = names.filter((_, i) => results[i].status === 'rejected')
    if (scaled.length === 0) {
      // 하나도 못 내렸다: 권한이 없는 것이 하나라도 있으면 그 이유를, 아니면 닿지 못한 것으로 알린다.
      const reasons = results.flatMap((r): unknown[] => (r.status === 'rejected' ? [r.reason] : []))
      throw asHttp(reasons.find((r) => r instanceof ClusterApiError && r.kind === 'forbidden') ?? reasons[0])
    }
    return { slug, scaled, failed }
  }
}
