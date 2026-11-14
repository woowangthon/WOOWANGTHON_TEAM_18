import { statusLabel, type DeployStatus } from './progress.ts'
import { stateText, stateVariant, waitingText } from './metrics.ts'
import type { Metrics } from './metrics.ts'
import type { ServiceSpec } from './types.ts'

// 서비스 구성도의 칸 배치. 저장한 배포 설정(spec)에서만 만든다: 서비스 · 역할 · 공개 경로 · 서비스끼리의 연결(runtime.links).
// 화살표 a → b는 "a가 b의 주소를 받아 쓴다"(a의 links에 b가 있다)는 뜻이다. 데이터베이스처럼 설정에 없는 것은 그리지 않는다.
export type MapNode = {
  name: string
  role: string
  kind: string
  ingressPath: string | null
  secretCount: number
  col: number
  row: number
}
export type MapEdge = { from: string; to: string }
export type MapLayout = { nodes: MapNode[]; edges: MapEdge[]; cols: number; rows: number }

export function layoutServices(services: ServiceSpec[]): MapLayout {
  const names = new Set(services.map((s) => s.name))
  const edges: MapEdge[] = services.flatMap((s) =>
    [...new Set(s.runtime.links.map((l) => l.service))]
      .filter((to) => names.has(to) && to !== s.name)
      .map((to) => ({ from: s.name, to })),
  )
  // 연결을 받지 않는 서비스가 첫 열이고, 그 서비스가 쓰는 쪽이 한 열씩 오른쪽으로 간다(가장 긴 길 기준). 돌고 도는 연결이어도 서비스 수만큼만 되풀이한다.
  const col = new Map(services.map((s) => [s.name, 0]))
  for (let pass = 0; pass < services.length; pass += 1) {
    for (const { from, to } of edges) col.set(to, Math.max(col.get(to) ?? 0, (col.get(from) ?? 0) + 1))
  }
  const used = new Map<number, number>()
  const nodes = services.map((s) => {
    const c = Math.min(col.get(s.name) ?? 0, services.length - 1)
    const row = used.get(c) ?? 0
    used.set(c, row + 1)
    return { name: s.name, role: s.role, kind: s.runtime.kind, ingressPath: s.runtime.ingressPath, secretCount: s.runtime.secretKeys.length, col: c, row }
  })
  return { nodes, edges, cols: Math.max(...nodes.map((n) => n.col), 0) + 1, rows: Math.max(...used.values(), 1) }
}

export type NodeState = { text: string; variant: 'ok' | 'warn' | 'err' | 'info' | 'neutral'; detail?: string }

// 서비스 하나의 상태. 지금 공개 중인 배포면 실제 서비스 상태(지표)를 쓰고, 그 밖에는 배포 전체의 단계에서 정한다
// (진행 중에는 서비스별 실제 상태를 서버가 주지 않는다). 모르는 것은 아는 척하지 않는다.
export function nodeStateOf(
  name: string,
  { status, failureService, metrics }: { status: DeployStatus; failureService: string | null; metrics: Metrics | undefined },
): NodeState {
  if (metrics?.state === 'live') {
    const service = metrics.services.find((s) => s.name === name)
    // 문구 · 색은 서비스 카드와 같은 stateText · stateVariant를 쓴다.
    if (service && ['running', 'starting', 'stopped'].includes(service.state)) {
      const detail = service.state === 'starting' && service.waiting ? waitingText(service.waiting) : undefined
      return { text: stateText(service.state), variant: stateVariant(service.state), detail }
    }
  }
  switch (status) {
    case 'not_started':
    case 'queued':
      // 배포 전체의 상태와 같은 이름(목록 · 배지와 같게).
      return { text: statusLabel(status), variant: 'neutral' }
    case 'running':
    case 'fixing':
      return { text: '배포 중', variant: 'info' }
    case 'failed':
      return name === failureService ? { text: '실패', variant: 'err' } : { text: '배포 중단', variant: 'neutral' }
    case 'needs_user':
      return name === failureService ? { text: '조치 필요', variant: 'warn' } : { text: '대기', variant: 'neutral' }
    case 'succeeded':
      return metrics?.state === 'not_live' && metrics.reason === 'superseded'
        ? { text: '새 배포가 공개 중', variant: 'neutral' }
        : { text: '상태 확인 중', variant: 'neutral' }
  }
}

// 성공한 배포의 한 줄 상태. 서비스가 아직 시작하는 중이면 "끝났어요"만 말해 헷갈리지 않게 클라우드 말로 이어서 알린다.
export function readinessText(metrics: Metrics | undefined): string {
  if (metrics?.state !== 'live' || metrics.services.length === 0) return '배포가 끝났어요'
  if (metrics.services.some((s) => s.state === 'starting')) return `배포 완료 · ${stateText('starting')}`
  if (metrics.services.every((s) => s.state === 'running')) return stateText('running')
  return '배포가 끝났어요'
}
