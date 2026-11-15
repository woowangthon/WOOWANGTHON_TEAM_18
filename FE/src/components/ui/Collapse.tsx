import { useState } from 'react'
import type { ReactNode } from 'react'

// 눌러서 펴고 접는 영역(네이티브 details). 열림 상태는 직접 들고 있어서, 안의 내용이 바뀌어 다시 그려져도
// 사용자가 펴 둔 것을 닫지 않는다. summary는 접힌 채로도 늘 보이는 부분이다. 접기 · 자세히 보기는 눈에 띄게 오른쪽에 본문 글자색으로 둔다.
export function Collapse({
  summary,
  defaultOpen = false,
  className = '',
  children,
}: {
  summary: ReactNode
  defaultOpen?: boolean
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open)
      }}
      className={className}
    >
      <summary className="flex cursor-pointer list-none flex-col gap-2">
        {summary}
        <span className="self-end text-sm font-bold text-fg">{open ? '접기' : '자세히 보기'}</span>
      </summary>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </details>
  )
}
