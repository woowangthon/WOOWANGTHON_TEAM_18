import { useState } from 'react'
import type { PointerEvent } from 'react'

// 선 그래프. 가로축(시각) · 세로축(단위가 붙은 값) · 눈금선이 있고, 마우스를 올리면 그 자리의 값을 말풍선으로 보인다. 라이브러리 없이 SVG와 글자로 그린다.
// 값이 null인 자리(수집하지 못한 때)는 선을 잇지 않고 끊는다. 값이 하나도 없으면 선 대신 안내만 보이고 0이나 가짜 선을 그리지 않는다.
// 세로축은 0에서 시작한다(작은 변화를 크게 보이려고 바닥을 올리지 않는다).
type LineChartProps = {
  values: (number | null)[]
  // 무엇의 그래프인지. 화면 낭독기가 읽는 요약의 앞머리가 된다(예: "CPU 사용량").
  label: string
  // 값을 단위가 붙은 글자로 바꾸는 함수. 세로축 눈금 · 말풍선 · 요약이 모두 쓴다.
  format?: (value: number) => string
  // 값이 없을 때(전부 null이거나 비었을 때, 그리고 가장 최근 값이 null일 때) 보일 말. 호출하는 쪽의 문구다.
  emptyText: string
  // i번째 칸이 언제인지(가로축 눈금과 말풍선). 없으면 가로축을 그리지 않는다.
  xAt?: (index: number) => string
  // 기준선(요청량 · 한도처럼 응답에 실제로 있는 값). 값이 있을 때만 넘긴다. 세로축 범위에 들어간다.
  reference?: { value: number; label: string }
  className?: string
}

const GRID_ROWS = 2
const X_TICKS = 3

// 위쪽 끝을 1 · 2 · 5 × 10ⁿ으로 올려 눈금이 둥근 수가 되게 한다.
function niceMax(value: number) {
  if (value <= 0) return 1
  const unit = 10 ** Math.floor(Math.log10(value))
  const f = value / unit
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * unit
}

const xFraction = (i: number, n: number) => (n === 1 ? 0.5 : i / (n - 1))

// null에서 끊어 이어진 구간(점 목록)으로 나눈다. 좌표는 0~100 상자이고 y는 위가 0이다.
function segmentsOf(values: (number | null)[], top: number) {
  const segments: [number, number][][] = []
  let open: [number, number][] | null = null
  values.forEach((v, i) => {
    if (v === null) {
      open = null
      return
    }
    if (!open) {
      open = []
      segments.push(open)
    }
    open.push([xFraction(i, values.length) * 100, 100 - (v / top) * 100])
  })
  return segments
}

// 가장 가까운 값이 있는 칸. 값이 없는 칸 위에서는 양옆 중 가까운 쪽으로 간다.
function nearestIndex(values: (number | null)[], target: number) {
  for (let d = 0; d < values.length; d += 1) {
    for (const i of [target - d, target + d]) if (values[i] !== undefined && values[i] !== null) return i
  }
  return null
}

export function LineChart({ values, label, format = String, emptyText, xAt, reference, className = '' }: LineChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const present = values.filter((v): v is number => v !== null)
  if (present.length === 0) {
    return (
      <p role="status" className={`text-sm text-muted ${className}`}>
        {label}: {emptyText}
      </p>
    )
  }
  const min = Math.min(...present)
  const max = Math.max(...present)
  const top = niceMax(Math.max(max, reference?.value ?? 0))
  const current = values[values.length - 1]
  const summary = `최저 ${format(min)} · 최고 ${format(max)} · 지금 ${current === null ? emptyText : format(current)}`
  const n = values.length
  const rows = Array.from({ length: GRID_ROWS + 1 }, (_, r) => (top * r) / GRID_ROWS)
  const ticks = n === 1 ? [0] : Array.from({ length: X_TICKS }, (_, k) => Math.round(((n - 1) * k) / (X_TICKS - 1)))
  const shown = hover === null ? null : values[hover]
  const shownAt = hover === null ? 0 : xFraction(hover, n)

  function move(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width === 0) return
    const f = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
    setHover(nearestIndex(values, Math.round(f * (n - 1))))
  }

  return (
    <figure role="img" aria-label={`${label}: ${summary}`} className={`m-0 flex flex-col gap-1 ${className}`}>
      <div aria-hidden="true" className="flex gap-2">
        <div className="relative h-40 w-16 shrink-0 text-xs text-muted">
          {rows.map((v) => (
            <span key={v} style={{ top: `${100 - (v / top) * 100}%` }} className="absolute right-0 -translate-y-1/2 whitespace-nowrap">
              {format(v)}
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            className="relative h-40 border-b border-l border-line-strong"
            onPointerMove={move}
            onPointerLeave={() => {
              setHover(null)
            }}
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
              {rows.slice(1).map((v) => (
                <line key={v} x1="0" x2="100" y1={100 - (v / top) * 100} y2={100 - (v / top) * 100} strokeWidth={1} vectorEffect="non-scaling-stroke" className="stroke-line" />
              ))}
              {reference && (
                <line
                  x1="0"
                  x2="100"
                  y1={100 - (reference.value / top) * 100}
                  y2={100 - (reference.value / top) * 100}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                  className="stroke-warn"
                />
              )}
              {segmentsOf(values, top).map((points, i) => {
                // 점 하나짜리 구간은 길이 0인 선에 둥근 끝을 줘서 점으로 보인다.
                const dot = points.length === 1
                return (
                  <path
                    key={i}
                    d={dot ? `M${points[0][0]} ${points[0][1]}h0` : `M${points.map(([x, y]) => `${x} ${y}`).join('L')}`}
                    fill="none"
                    strokeWidth={dot ? 6 : 2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    className="stroke-accent-ui"
                  />
                )
              })}
            </svg>
            {reference && (
              <span style={{ top: `${100 - (reference.value / top) * 100}%` }} className="absolute right-1 -translate-y-full text-xs text-warn">
                {reference.label} {format(reference.value)}
              </span>
            )}
            {hover !== null && shown !== null && shown !== undefined && (
              <>
                <div style={{ left: `${shownAt * 100}%` }} className="absolute inset-y-0 w-px bg-line-strong" />
                <div
                  style={{ left: `${shownAt * 100}%`, top: `${100 - (shown / top) * 100}%` }}
                  className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-ui"
                />
                <div
                  role="tooltip"
                  style={{ left: `${shownAt * 100}%` }}
                  className={`absolute top-0 z-10 rounded-sm border border-line-strong bg-bg px-2 py-1 text-xs whitespace-nowrap ${shownAt > 0.6 ? '-translate-x-full' : ''}`}
                >
                  {xAt ? `${xAt(hover)} · ` : ''}
                  {format(shown)}
                </div>
              </>
            )}
          </div>
          {xAt && (
            <div className="relative h-4 text-xs text-muted">
              {ticks.map((i, k) => (
                <span
                  key={i}
                  style={{ left: `${xFraction(i, n) * 100}%` }}
                  className={`absolute whitespace-nowrap ${k === 0 && n > 1 ? '' : k === ticks.length - 1 && n > 1 ? '-translate-x-full' : '-translate-x-1/2'}`}
                >
                  {xAt(i)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <figcaption aria-hidden="true" className="text-xs text-muted">
        {summary}
      </figcaption>
    </figure>
  )
}
