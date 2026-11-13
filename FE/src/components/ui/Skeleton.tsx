import type { HTMLAttributes } from 'react'

// 모양을 아는 콘텐츠의 첫 로딩 자리. 스크린 리더에는 숨기고, 기다림은 화면의 다른 문구가 알린다.
// 모션을 줄인 환경에서는 반짝임 없이 단색이다.
export function Skeleton({
  block = false,
  className = '',
  ...rest
}: Omit<HTMLAttributes<HTMLSpanElement>, 'aria-hidden'> & { block?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton block ${block ? 'h-20 rounded-md' : 'h-3 rounded-sm'} ${className}`}
      {...rest}
    />
  )
}

// 화면 하나의 데이터나 코드를 기다리는 동안의 자리: 블록 Skeleton과 "불러오는 중…" 알림.
export function LoadingBlock() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton block />
      <p role="status" className="text-sm text-muted">
        불러오는 중…
      </p>
    </div>
  )
}
