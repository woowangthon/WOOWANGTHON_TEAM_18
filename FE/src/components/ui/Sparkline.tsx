// 작은 선 그래프. 축 대신 최솟값 · 최댓값 · 현재 값을 글자로 보인다. 라이브러리 없이 SVG 하나로 그린다.
// 값이 null인 자리(수집하지 못한 때)는 선을 잇지 않고 끊는다. 값이 하나도 없으면 선 대신 안내만 보이고 0이나 가짜 선을 그리지 않는다.
type SparklineProps = {
  values: (number | null)[]
  // 무엇의 그래프인지. 화면 낭독기가 읽는 요약의 앞머리가 된다(예: "CPU 사용량").
  label: string
  // 값을 글자로 바꾸는 함수(단위 붙이기 등).
  format?: (value: number) => string
  // 값이 없을 때(전부 null이거나 비었을 때, 그리고 가장 최근 값이 null일 때) 보일 말. 호출하는 쪽의 문구다.
  emptyText: string
  className?: string
}

const W = 120
const H = 32
const PAD = 3

// null에서 끊어 이어진 구간(점 목록)으로 나눈다.
function segmentsOf(values: (number | null)[], min: number, max: number) {
  const range = max - min
  const last = values.length - 1
  const segments: [number, number][][] = []
  let open: [number, number][] | null = null
  values.forEach((v, i) => {
    if (v === null) {
      open = null
      return
    }
    const x = last === 0 ? W / 2 : PAD + (i / last) * (W - 2 * PAD)
    // 모든 값이 같으면(range가 0) 가운데 높이에 그린다.
    const y = max === min ? H / 2 : H - PAD - ((v - min) / range) * (H - 2 * PAD)
    if (!open) {
      open = []
      segments.push(open)
    }
    open.push([x, y])
  })
  return segments
}

export function Sparkline({ values, label, format = String, emptyText, className = '' }: SparklineProps) {
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
  const current = values[values.length - 1]
  const summary = `최저 ${format(min)} · 최고 ${format(max)} · 지금 ${current === null ? emptyText : format(current)}`
  return (
    <figure role="img" aria-label={`${label}: ${summary}`} className={`m-0 flex flex-col gap-1 ${className}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" className="h-8 w-full overflow-visible">
        {segmentsOf(values, min, max).map((points, i) => {
          // 점 하나짜리 구간은 길이 0인 선에 둥근 끝을 줘서 점으로 보인다.
          const dot = points.length === 1
          return (
          <path
            key={i}
            d={dot ? `M${points[0][0]} ${points[0][1]}h0` : `M${points.map(([x, y]) => `${x} ${y}`).join('L')}`}
            fill="none"
            strokeWidth={dot ? 5 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className="stroke-accent-ui"
          />
          )
        })}
      </svg>
      <figcaption aria-hidden="true" className="text-xs text-muted">
        {summary}
      </figcaption>
    </figure>
  )
}
