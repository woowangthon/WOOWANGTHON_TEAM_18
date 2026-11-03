import type { ButtonHTMLAttributes } from 'react'

// 비활성은 opacity가 아니라 토큰으로 그린다. opacity는 배경과 글씨를 함께 옅게 해서 글씨가 안 읽힌다.
const variants = {
  primary:
    'border border-transparent bg-fg text-bg hover:opacity-85 disabled:border-line disabled:bg-surface disabled:text-muted',
  outline:
    'border border-line-strong text-fg hover:border-fg disabled:border-line disabled:text-muted',
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants
}

export function Button({
  variant = 'primary',
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex h-8 items-center justify-center rounded-sm px-3 text-sm font-bold disabled:pointer-events-none ${variants[variant]} ${className}`}
      {...rest}
    />
  )
}
