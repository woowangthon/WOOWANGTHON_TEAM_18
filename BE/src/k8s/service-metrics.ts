import { bytes, millicores } from '../admin/quantity.js'
import type { Logger } from '@nestjs/common'
import { ClusterError } from './cluster-error.js'
import type { ClusterReader, PodUsageInfo, RangeSeries } from './cluster-reader.js'

// 서비스 단위 지표 계산. 운영자 API(admin.service)와 학생 지표 API(deploy-metrics.service)가 같이 쓴다. 계약은 docs/design/api.md.

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Pod가 그 Deployment의 것인가. Pod 이름은 `<Deployment>-<ReplicaSet 해시>-<5자>`다.
 * `fe`와 `fe-a`처럼 접두사가 겹치는 이름이 섞이지 않게 모양 전체를 본다.
 */
export function ownsPod(deployment: string, pod: string): boolean {
  return new RegExp(`^${escapeRegExp(deployment)}-[a-z0-9]+-[a-z0-9]{5}$`).test(pod)
}

export interface Usage {
  cpuMillicores: number
  memoryBytes: number
}

/** Pod 하나의 사용량: 컨테이너들의 합. 한 칸이라도 없거나 읽을 수 없으면 값을 지어내지 않고 null이다. */
function podUsage({ containers }: PodUsageInfo): Usage | null {
  if (containers.length === 0) return null
  let cpuMillicores = 0
  let memoryBytes = 0
  for (const container of containers) {
    const cpu = millicores(container.cpu)
    const memory = bytes(container.memory)
    if (cpu === null || memory === null) return null
    cpuMillicores += cpu
    memoryBytes += memory
  }
  return { cpuMillicores, memoryBytes }
}

/** Pod 이름별 사용량. 읽을 수 없는 Pod는 없는 것으로 친다. */
export function usageByPod(infos: PodUsageInfo[]): Map<string, Usage> {
  const out = new Map<string, Usage>()
  for (const info of infos) {
    const usage = podUsage(info)
    if (usage) out.set(info.name, usage)
  }
  return out
}

/**
 * 한 서비스 Pod들의 사용량 합. 그 서비스의 Pod가 하나도 목록에 없으면(없거나 첫 수집 전) null이고,
 * 일부만 있으면 있는 것의 합이다. `usage`가 null이면(읽지 못함) 늘 null이다.
 */
export function serviceUsage(podNames: string[], usage: Map<string, Usage> | null): Usage | null {
  if (usage === null) return null
  const found = podNames.map((name) => usage.get(name)).filter((u): u is Usage => u !== undefined)
  if (found.length === 0) return null
  return {
    cpuMillicores: found.reduce((sum, u) => sum + u.cpuMillicores, 0),
    memoryBytes: found.reduce((sum, u) => sum + u.memoryBytes, 0),
  }
}

export interface SeriesPoint {
  t: number
  v: number
}

/** 시각별 합. Pod마다 점의 시각이 같지 않아도(중간에 뜬 Pod) 있는 점끼리 더한다. 시각 오름차순, `scale`은 곱할 수(core → 밀리코어), 값은 정수로 반올림한다. */
export function sumPoints(series: RangeSeries[], scale = 1): SeriesPoint[] {
  const byTime = new Map<number, number>()
  for (const { points } of series) for (const { t, v } of points) byTime.set(t, (byTime.get(t) ?? 0) + v)
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v: Math.round(v * scale) }))
}

export interface ServiceSeries {
  name: string
  cpuMillicores: SeriesPoint[]
  memoryBytes: SeriesPoint[]
}

/**
 * 서비스마다 그 서비스 Pod들의 시계열 합. 읽은 Pod 이름(지난 한 시간에 있었던 것 포함)을 Deployment 이름으로 가른다.
 * 점이 없는 서비스도 빠뜨리지 않고 빈 배열로 담는다(`services`와 같은 이름을 같은 순서로).
 */
export function seriesByService(
  services: { name: string; deployment: string }[],
  cpu: RangeSeries[],
  memory: RangeSeries[],
): ServiceSeries[] {
  return services.map(({ name, deployment }) => ({
    name,
    cpuMillicores: sumPoints(cpu.filter((s) => ownsPod(deployment, s.pod)), 1000),
    memoryBytes: sumPoints(memory.filter((s) => ownsPod(deployment, s.pod))),
  }))
}

/** 로그에 남길 오류 설명: 종류와 API 상태뿐이다(응답 본문 · 주소는 남기지 않는다). */
export const errorKind = (err: unknown) => (err instanceof ClusterError ? `${err.kind} ${err.apiStatus ?? ''}`.trim() : 'error')

/** 공간의 Pod별 현재 사용량. 읽지 못하면 값을 지어내지 않고 null이다. */
export async function readUsageByPod(reader: ClusterReader, logger: Logger, slug: string): Promise<Map<string, Usage> | null> {
  try {
    return usageByPod(await reader.podUsage(slug))
  } catch (err) {
    logger.warn(`Pod usage not read: ${errorKind(err)}`)
    return null
  }
}
