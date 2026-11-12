// 개수를 아는 진행 · 사용량 막대. 값은 role=progressbar로 읽힌다.
type MeterProps = {
  value: number
  max?: number
  'aria-label': string
  className?: string
}

export function Meter({ value, max = 100, className = '', ...rest }: MeterProps) {
  // 막대 너비와 읽어 주는 값을 같은 [0, max] 범위로 자른다(범위 밖 aria-valuenow는 무효). max가 0이면 0%다.
  const now = Math.min(max, Math.max(0, value))
  const pct = max > 0 ? (now / max) * 100 : 0
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={now}
      className={`h-2 overflow-hidden rounded-sm border border-line bg-bg ${className}`}
      {...rest}
    >
      <div className="h-full bg-accent-ui" style={{ width: `${pct}%` }} />
    </div>
  )
}
