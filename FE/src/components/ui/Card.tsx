import type { HTMLAttributes } from 'react'

export function Card({
  className = '',
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-md border border-line bg-bg p-4 ${className}`}
      {...rest}
    />
  )
}
