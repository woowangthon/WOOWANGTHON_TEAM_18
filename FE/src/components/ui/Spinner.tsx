import type { HTMLAttributes } from 'react'

const sizes = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-8 w-8 border-4' }

// 돌고 있다는 뜻은 role=status와 이름으로 전하고, 빈 status는 읽지 않는 화면 낭독기가 있어 같은 글을 sr-only로도 둔다. 모션을 줄인 환경에서는 천천히 돈다.
type SpinnerProps = Omit<HTMLAttributes<HTMLSpanElement>, 'role'> & {
  size?: keyof typeof sizes
  label?: string
}

export function Spinner({
  size = 'md',
  label = '불러오는 중',
  className = '',
  ...rest
}: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`inline-block flex-none spinner rounded-full border-2 border-line-strong border-t-accent-ui ${sizes[size]} ${className}`}
      {...rest}
    >
      <span className="sr-only">{label}</span>
    </span>
  )
}
