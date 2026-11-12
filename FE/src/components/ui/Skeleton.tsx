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
