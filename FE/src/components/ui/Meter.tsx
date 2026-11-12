// 개수를 아는 진행 · 사용량 막대. 값은 role=progressbar로 읽힌다.
type MeterProps = {
  value: number
  max?: number
  'aria-label': string
  className?: string
}

export function Meter({ value, max = 100, className = '', ...rest }: MeterProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`h-2 overflow-hidden rounded-sm border border-line bg-surface ${className}`}
      {...rest}
    >
      <div className="h-full bg-accent-ui" style={{ width: `${pct}%` }} />
    </div>
  )
}
