import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { bytes, millicores } from '../admin/quantity.js'
import type { Env } from '../config/env.js'
import { ClusterError } from './cluster-error.js'
import { ClusterReader } from './cluster-reader.js'

const CACHE_MS = 10_000

/**
 * 클러스터에 새 배포가 들어갈 자리가 있는지. 기준은 워커 노드(control-plane이 아니고 Ready)의 실제 사용량이다:
 * CPU 사용 합 / 할당 가능 합, 메모리 사용 합 / 할당 가능 합 중 큰 값이 `CLUSTER_FULL_PERCENT` 이상이면 자리가 없다.
 * 답은 10초 동안 쓴다. 읽지 못하면(지표 서버 문제 등) 막지 않는다: 지표 때문에 배포가 서지 않게 한다.
 */
@Injectable()
export class ClusterCapacity {
  private readonly logger = new Logger(ClusterCapacity.name)
  private readonly fullPercent: number
  private cached: { full: boolean; at: number } | undefined

  constructor(
    private readonly reader: ClusterReader,
    config: ConfigService<Env, true>,
  ) {
    this.fullPercent = config.get('CLUSTER_FULL_PERCENT', { infer: true })
  }

  async isFull(): Promise<boolean> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.full
    const full = await this.read()
    this.cached = { full, at: Date.now() }
    return full
  }

  private async read(): Promise<boolean> {
    try {
      const [nodes, usages] = await Promise.all([this.reader.nodes(), this.reader.nodeUsage()])
      const usageOf = new Map(usages.map((u) => [u.name, u.usage]))
      const total = { cpuUsed: 0, cpuAllocatable: 0, memUsed: 0, memAllocatable: 0 }
      for (const node of nodes) {
        if (!node.ready || node.roles.includes('control-plane')) continue
        const usage = usageOf.get(node.name)
        const cpu = millicores(node.allocatable.cpu)
        const mem = bytes(node.allocatable.memory)
        const cpuUsed = millicores(usage?.cpu)
        const memUsed = bytes(usage?.memory)
        // 사용량이 아직 없는(갓 뜬) 노드는 셈에서 뺀다.
        if (cpu === null || mem === null || cpuUsed === null || memUsed === null) continue
        total.cpuAllocatable += cpu
        total.memAllocatable += mem
        total.cpuUsed += cpuUsed
        total.memUsed += memUsed
      }
      if (total.cpuAllocatable <= 0 || total.memAllocatable <= 0) return false
      const percent = Math.max((total.cpuUsed / total.cpuAllocatable) * 100, (total.memUsed / total.memAllocatable) * 100)
      return percent >= this.fullPercent
    } catch (err) {
      this.logger.warn(`Cluster usage not read, treating as not full: ${err instanceof ClusterError ? `${err.kind} ${err.apiStatus ?? ''}`.trim() : 'error'}`)
      return false
    }
  }
}
