import type { InputHTMLAttributes } from 'react'

// 보이는 라벨을 만들지 않으므로, 쓰는 쪽이 이름을 줘야 한다. 린트는 컴포넌트 안을 못 봐서 타입으로 강제한다.
type InputProps = InputHTMLAttributes<HTMLInputElement> &
  ({ 'aria-label': string } | { 'aria-labelledby': string })

export function Input({ className = '', ...rest }: InputProps) {
  return (
    <input
      className={`h-8 w-full rounded-sm border border-line-strong bg-bg px-3 text-sm text-fg placeholder:text-muted disabled:border-line disabled:bg-surface disabled:text-muted ${className}`}
      {...rest}
    />
  )
}
