import { Injectable, Logger } from '@nestjs/common'
import { isRecord } from '../common/is-record.js'
import { SLUG } from '../deploys/deploy-input.js'
import { ClusterError } from './cluster-error.js'
import { K8sClient } from './k8s.client.js'

export interface PodInfo {
  name: string
  labels: Record<string, string>
  /** Pending · Running · Succeeded · Failed · Unknown */
  phase: string
  /** 놓인 노드. 아직 놓이지 않았으면 null */
  node: string | null
  /** 컨테이너가 모두 준비됨 */
  ready: boolean
  /** 컨테이너 재시작 횟수의 합 */
  restarts: number
  /** 기다리는 컨테이너(init 컨테이너 포함)의 이유(CrashLoopBackOff · ImagePullBackOff 등). 없으면 null */
  waiting: string | null
}

export interface DeploymentInfo {
  name: string
  labels: Record<string, string>
  /** 원하는 수 */
  replicas: number
  ready: number
  updated: number
  available: number
}

export interface NodeInfo {
  name: string
  ready: boolean
  /** node-role.kubernetes.io/<역할> 라벨의 역할들 */
  roles: string[]
  /** cpu · memory · ephemeral-storage, 쿠버네티스 수량 글 그대로("8", "16308480Ki") */
  capacity: Record<string, string>
  allocatable: Record<string, string>
}

/** metrics.k8s.io가 준 노드의 사용량. 쿠버네티스 수량 글 그대로("123018642n", "6838040Ki"). */
export interface NodeUsageInfo {
  name: string
  /** cpu · memory(· ephemeral-storage)의 수량 글. 없는 칸은 빠진다 */
  usage: Record<string, string>
}

const POD_NAME = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/
const CONTAINER_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const DEFAULT_TAIL = 200
const MAX_TAIL = 2000
// 요청 하나의 제한 시간(5초) 안에 느린 구간(Tailscale 중계)으로도 받을 수 있는 크기다.
const MAX_LOG_BYTES = 256 * 1024
const ROLE_LABEL = 'node-role.kubernetes.io/'
const RESOURCES = ['cpu', 'memory', 'ephemeral-storage']

/**
 * 서버가 만든 공간 `proj-<slug>`의 Pod · 로그 · Deployment와 노드를 읽는다. 설계는 docs/design/cluster-client.md.
 * 쿠버네티스 응답을 그대로 넘기지 않고 아래 칸만 고른다(Pod 응답 전체에는 컨테이너의 env 값이 들어 있다).
 * 실패는 ClusterError다: 서버가 만들지 않은 공간은 forbidden, 사라진 Pod의 로그는 not_found.
 */
@Injectable()
export class ClusterReader {
  private readonly logger = new Logger(ClusterReader.name)

  constructor(private readonly k8s: K8sClient) {}

  async pods(slug: string): Promise<PodInfo[]> {
    return (await this.list(`/api/v1/namespaces/${space(slug)}/pods`)).map((pod) => {
      const statuses = records(record(pod.status).containerStatuses)
      // init 컨테이너에서 멈춘 Pod(이미지를 못 받음 등)의 이유도 여기서 보인다.
      const waiting = [...records(record(pod.status).initContainerStatuses), ...statuses].map((s) => record(record(s.state).waiting).reason).find((r) => typeof r === 'string')
      return {
        ...nameAndLabels(pod),
        phase: text(record(pod.status).phase) ?? 'Unknown',
        node: text(record(pod.spec).nodeName) ?? null,
        ready: statuses.length > 0 && statuses.every((s) => s.ready === true),
        restarts: statuses.reduce((sum, s) => sum + count(s.restartCount), 0),
        waiting: waiting ?? null,
      }
    })
  }

  async deployments(slug: string): Promise<DeploymentInfo[]> {
    return (await this.list(`/apis/apps/v1/namespaces/${space(slug)}/deployments`)).map((deployment) => {
      const status = record(deployment.status)
      return {
        ...nameAndLabels(deployment),
        replicas: count(record(deployment.spec).replicas),
        ready: count(status.readyReplicas),
        updated: count(status.updatedReplicas),
        available: count(status.availableReplicas),
      }
    })
  }

  async nodes(): Promise<NodeInfo[]> {
    return (await this.list('/api/v1/nodes')).map((node) => {
      const { name, labels } = nameAndLabels(node)
      const status = record(node.status)
      return {
        name,
        ready: records(status.conditions).some((c) => c.type === 'Ready' && c.status === 'True'),
        roles: Object.keys(labels)
          .filter((label) => label.startsWith(ROLE_LABEL))
          .map((label) => label.slice(ROLE_LABEL.length)),
        capacity: quantities(status.capacity),
        allocatable: quantities(status.allocatable),
      }
    })
  }

  /**
   * 노드의 실제 사용량(metrics.k8s.io). 갓 뜬 노드는 첫 수집 전까지 목록에 없다. 이름 없는 항목은 버린다.
   * 이 API가 없거나 막혀 있으면 다른 읽기처럼 ClusterError다.
   */
  async nodeUsage(): Promise<NodeUsageInfo[]> {
    return (await this.list('/apis/metrics.k8s.io/v1beta1/nodes'))
      .map((node) => ({ name: text(record(node.metadata).name) ?? '', usage: quantities(node.usage) }))
      .filter((u) => u.name !== '')
  }

  /**
   * AI 에이전트 게이트웨이의 관찰 도구용: 원본 객체를 그대로 준다(api.md "MCP 게이트웨이"). `metadata.managedFields`와 적용 기록 주석만 뺀다.
   * 비밀값처럼 보이는 문자열은 부른 쪽이 밖으로 보내기 전에 가린다. `labelSelector`는 `app=be,slot=a`처럼 우리 코드가 만든 값이다.
   */
  async rawObjects(slug: string, kind: 'pods' | 'events' | 'deployments', labelSelector?: string): Promise<Record<string, unknown>[]> {
    const base = kind === 'deployments' ? `/apis/apps/v1/namespaces/${space(slug)}/deployments` : `/api/v1/namespaces/${space(slug)}/${kind}`
    const items = await this.list(labelSelector ? `${base}?labelSelector=${encodeURIComponent(labelSelector)}` : base)
    return items.map(withoutBookkeeping)
  }

  /** Pod 로그의 끝부분. `tailLines`는 기본 200, 최대 2000이고 응답은 256 KiB에서 잘린다. `previous`면 직전 컨테이너의 로그다. */
  async logs(
    slug: string,
    pod: string,
    { container, tailLines = DEFAULT_TAIL, previous = false }: { container?: string; tailLines?: number; previous?: boolean } = {},
  ): Promise<string> {
    // 요청 경로와 쿼리에 들어가는 값이다.
    if (!POD_NAME.test(pod)) throw new Error(`Not a valid pod name: ${JSON.stringify(pod)}`)
    if (container !== undefined && !CONTAINER_NAME.test(container)) throw new Error(`Not a valid container name: ${JSON.stringify(container)}`)
    if (!Number.isInteger(tailLines) || tailLines < 1) throw new Error(`Not a valid tailLines: ${JSON.stringify(tailLines)}`)
    const query = `tailLines=${Math.min(tailLines, MAX_TAIL)}&limitBytes=${MAX_LOG_BYTES}${container ? `&container=${container}` : ''}${previous ? '&previous=true' : ''}`
    return this.k8s.request('GET', `/api/v1/namespaces/${space(slug)}/pods/${pod}/log?${query}`)
  }

  private async list(path: string): Promise<Record<string, unknown>[]> {
    const body = await this.k8s.request('GET', path)
    try {
      const parsed: unknown = JSON.parse(body)
      if (isRecord(parsed) && Array.isArray(parsed.items)) return records(parsed.items)
    } catch {
      // 아래에서 던진다.
    }
    // 200인데 목록이 아니다. 리더가 아닌 다른 것이 답했다.
    this.logger.error(`GET ${path} answered 200 without a list`)
    throw new ClusterError('unexpected', 200)
  }
}

export function space(slug: string): string {
  // 요청 경로에 들어가는 값이다. 검증을 통과하지 않은 값은 부른 쪽의 버그다.
  if (!SLUG.test(slug)) throw new Error(`Not a valid slug: ${JSON.stringify(slug)}`)
  return `proj-${slug}`
}

// 응답의 빠진 칸은 빈 값으로 읽는다(쿠버네티스는 0 · 빈 목록을 생략한다).
const record = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {})

const LAST_APPLIED = 'kubectl.kubernetes.io/last-applied-configuration'

/** 원본에서 `metadata.managedFields`와 적용 기록 주석을 뺀 사본. 나머지는 그대로다. */
function withoutBookkeeping(object: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(object.metadata)) return object
  const metadata = { ...object.metadata }
  delete metadata.managedFields
  if (isRecord(metadata.annotations)) {
    const annotations = { ...metadata.annotations }
    delete annotations[LAST_APPLIED]
    metadata.annotations = annotations
  }
  return { ...object, metadata }
}
const records = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : [])
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const count = (v: unknown): number => (typeof v === 'number' ? v : 0)

function strings(v: unknown, keep: (key: string) => boolean = () => true): Record<string, string> {
  return Object.fromEntries(Object.entries(record(v)).filter((e): e is [string, string] => typeof e[1] === 'string' && keep(e[0])))
}
const quantities = (v: unknown) => strings(v, (key) => RESOURCES.includes(key))

function nameAndLabels(object: Record<string, unknown>): { name: string; labels: Record<string, string> } {
  const metadata = record(object.metadata)
  return { name: text(metadata.name) ?? '', labels: strings(metadata.labels) }
}
