import type { HTMLAttributes } from 'react'

// Alert와 달리 제목 없이 한 줄 안내를 띄운다. 색만으로 뜻을 전하지 않도록 기호를 함께 둔다.
// 오류는 바로 읽어 주는 alert, 나머지는 기다렸다 읽는 status다.
const variants = {
  info: { box: 'border-info', mark: 'text-info' },
  ok: { box: 'border-ok', mark: 'text-ok' },
  warn: { box: 'border-warn', mark: 'text-warn' },
  err: { box: 'border-err', mark: 'text-err' },
}

// 린트가 variants 안의 문자열을 전부 클래스로 읽어서 기호는 따로 둔다.
const icons = { info: 'i', ok: '✓', warn: '!', err: '!' } as const

type BannerProps = Omit<HTMLAttributes<HTMLDivElement>, 'role'> & {
  variant?: keyof typeof variants
}

export function Banner({
  variant = 'info',
  className = '',
  children,
  ...rest
}: BannerProps) {
  const v = variants[variant]
  return (
    <div
      role={variant === 'err' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-md border bg-raise px-4 py-3 text-base ${v.box} ${className}`}
      {...rest}
    >
      <span aria-hidden="true" className={`font-bold ${v.mark}`}>
        {icons[variant]}
      </span>
      <div>{children}</div>
    </div>
  )
}
