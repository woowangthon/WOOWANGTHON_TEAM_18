import { Injectable } from '@nestjs/common'
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
  /** 기다리는 컨테이너의 이유(CrashLoopBackOff · ImagePullBackOff 등). 없으면 null */
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

const POD_NAME = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/
const CONTAINER_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const DEFAULT_TAIL = 200
const MAX_TAIL = 2000
const MAX_LOG_BYTES = 1024 * 1024
const ROLE_LABEL = 'node-role.kubernetes.io/'
const RESOURCES = ['cpu', 'memory', 'ephemeral-storage']

/**
 * 서버가 만든 공간 `proj-<slug>`의 Pod · 로그 · Deployment와 노드를 읽는다. 설계는 docs/design/cluster-client.md.
 * 쿠버네티스 응답을 그대로 넘기지 않고 아래 칸만 고른다(Pod 응답 전체에는 컨테이너의 env 값이 들어 있다).
 * 실패는 ClusterError다: 서버가 만들지 않은 공간은 forbidden, 사라진 Pod의 로그는 not_found.
 */
@Injectable()
export class ClusterReader {
  constructor(private readonly k8s: K8sClient) {}

  async pods(slug: string): Promise<PodInfo[]> {
    return (await this.list(`/api/v1/namespaces/${space(slug)}/pods`)).map((pod) => {
      const statuses = records(record(pod.status).containerStatuses)
      const waiting = statuses.map((s) => record(record(s.state).waiting).reason).find((r) => typeof r === 'string')
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

  /** Pod 로그의 끝부분. `tailLines`는 기본 200, 최대 2000이고 응답은 1 MiB에서 잘린다. */
  async logs(slug: string, pod: string, { container, tailLines = DEFAULT_TAIL }: { container?: string; tailLines?: number } = {}): Promise<string> {
    // 요청 경로와 쿼리에 들어가는 값이다.
    if (!POD_NAME.test(pod)) throw new Error(`Not a valid pod name: ${JSON.stringify(pod)}`)
    if (container !== undefined && !CONTAINER_NAME.test(container)) throw new Error(`Not a valid container name: ${JSON.stringify(container)}`)
    if (!Number.isInteger(tailLines) || tailLines < 1) throw new Error(`Not a valid tailLines: ${JSON.stringify(tailLines)}`)
    const query = `tailLines=${Math.min(tailLines, MAX_TAIL)}&limitBytes=${MAX_LOG_BYTES}${container ? `&container=${container}` : ''}`
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
    throw new ClusterError('unexpected', 200)
  }
}

function space(slug: string): string {
  // 요청 경로에 들어가는 값이다. 검증을 통과하지 않은 값은 부른 쪽의 버그다.
  if (!SLUG.test(slug)) throw new Error(`Not a valid slug: ${JSON.stringify(slug)}`)
  return `proj-${slug}`
}

// 응답의 빠진 칸은 빈 값으로 읽는다(쿠버네티스는 0 · 빈 목록을 생략한다).
const record = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {})
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
