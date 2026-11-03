import type { HTMLAttributes } from 'react'

const variants = {
  neutral: 'border-line-strong text-muted',
  ok: 'border-ok text-ok',
  warn: 'border-warn text-warn',
  err: 'border-err text-err',
  info: 'border-info text-info',
}

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: keyof typeof variants
}

export function Badge({
  variant = 'neutral',
  className = '',
  ...rest
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1.5 text-xs font-bold whitespace-nowrap ${variants[variant]} ${className}`}
      {...rest}
    />
  )
}
