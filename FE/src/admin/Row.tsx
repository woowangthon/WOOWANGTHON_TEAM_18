import type { ReactNode } from 'react'

// 이름과 값 한 줄. 390px에서도 이름 칸을 고정해 값이 줄바꿈되어도 줄이 맞는다.
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

export default Row
