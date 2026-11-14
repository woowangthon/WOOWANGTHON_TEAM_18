import { useMemo } from 'react'
import { Badge } from '../components/ui/Badge.tsx'
import { layoutServices, nodeStateOf } from './serviceMap.ts'
import type { MapLayout } from './serviceMap.ts'
import type { DeployStatus } from './progress.ts'
import type { Metrics } from './metrics.ts'
import type { ServiceSpec } from './types.ts'

const NODE_W = 176
const NODE_H = 96
const GAP_X = 72
const GAP_Y = 16

const left = (col: number) => col * (NODE_W + GAP_X)
const top = (row: number) => row * (NODE_H + GAP_Y)

function Edges({ layout }: { layout: MapLayout }) {
  const at = new Map(layout.nodes.map((n) => [n.name, n]))
  return (
    <svg aria-hidden="true" className="absolute inset-0 size-full overflow-visible" width="100%" height="100%">
      <defs>
        <marker id="map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0 0L10 5L0 10z" className="fill-line-strong" />
        </marker>
      </defs>
      {layout.edges.map(({ from, to }) => {
        const a = at.get(from)
        const b = at.get(to)
        if (!a || !b) return null
        const x1 = left(a.col) + NODE_W
        const y1 = top(a.row) + NODE_H / 2
        const x2 = left(b.col)
        const y2 = top(b.row) + NODE_H / 2
        const mid = (x1 + x2) / 2
        return (
          <path
            key={`${from}>${to}`}
            d={`M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`}
            fill="none"
            strokeWidth={2}
            markerEnd="url(#map-arrow)"
            className="stroke-line-strong"
          />
        )
      })}
    </svg>
  )
}

// 서비스 구성도: 서비스를 칸으로, 서비스끼리의 연결(주소를 받아 쓰는 방향)을 화살표로 그린다. 칸의 상태는 nodeStateOf가 정한다.
function ServiceMap({
  services,
  status,
  failureService,
  metrics,
}: {
  services: ServiceSpec[]
  status: DeployStatus
  failureService: string | null
  metrics: Metrics | undefined
}) {
  // 서비스 구성은 이 화면에서 바뀌지 않는다: 진행 상태를 읽을 때마다 다시 배치하지 않는다.
  const layout = useMemo(() => layoutServices(services), [services])
  return (
    <section aria-label="서비스 구성" className="flex flex-col gap-2">
      <h2 className="text-lg">서비스 구성</h2>
      <div className="overflow-x-auto rounded-md border border-line bg-surface p-4">
        <div className="relative" style={{ width: left(layout.cols - 1) + NODE_W, height: top(layout.rows - 1) + NODE_H }}>
          <Edges layout={layout} />
          {layout.nodes.map((node) => {
            const state = nodeStateOf(node.name, { status, failureService, metrics })
            return (
              <div
                key={node.name}
                role="group"
                aria-label={`서비스 ${node.name}`}
                style={{ left: left(node.col), top: top(node.row), width: NODE_W, height: NODE_H }}
                className="absolute flex flex-col justify-between rounded-md border border-line-strong bg-bg p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono font-bold">{node.name}</span>
                  <Badge>{node.role}</Badge>
                </div>
                <p className="truncate text-xs text-muted">
                  {node.kind === 'static' ? '정적 웹' : '서버'} · {node.ingressPath === null ? '내부 전용' : `공개 ${node.ingressPath}`}
                  {node.secretCount > 0 ? ` · 비밀값 ${node.secretCount}개` : ''}
                </p>
                <div className="flex items-center gap-2">
                  <Badge variant={state.variant}>{state.text}</Badge>
                  {state.detail && <span className="truncate text-xs text-muted">{state.detail}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {layout.edges.length > 0 ? (
        <>
          <p className="text-xs text-muted">화살표는 주소를 받아 쓰는 방향이에요.</p>
          <ul className="sr-only">
            {layout.edges.map(({ from, to }) => (
              <li key={`${from}>${to}`}>
                {from}가 {to}의 주소를 받아 써요
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

export default ServiceMap
