import type { HTMLAttributes } from 'react'

// 색만으로 뜻을 전하지 않도록 제목 글자를 필수로 받는다(Badge와 같은 원칙).
// 오류는 바로 읽어 주는 alert, 경고와 안내는 기다렸다 읽는 status다.
const variants = {
  err: { box: 'border-err', title: 'text-err' },
  warn: { box: 'border-warn', title: 'text-warn' },
  info: { box: 'border-info', title: 'text-info' },
}

// 린트가 variants 안의 문자열을 전부 클래스로 읽어서 역할은 따로 둔다.
const roles = { err: 'alert', warn: 'status', info: 'status' } as const

type AlertProps = Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'role'> & {
  variant?: keyof typeof variants
  title: string
}

export function Alert({
  variant = 'err',
  title,
  className = '',
  children,
  ...rest
}: AlertProps) {
  const v = variants[variant]
  return (
    <div
      role={roles[variant]}
      className={`rounded-md border bg-bg p-3 ${v.box} ${className}`}
      {...rest}
    >
      <p className={`text-sm font-bold ${v.title}`}>{title}</p>
      {children ? <div className="mt-1 text-sm text-fg">{children}</div> : null}
    </div>
  )
}
