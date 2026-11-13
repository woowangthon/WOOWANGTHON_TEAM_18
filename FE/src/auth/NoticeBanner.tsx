import type { ReactNode } from 'react'
import { Banner } from '../components/ui/Banner.tsx'

// 제목 + 설명이 있는 안내. 인증 화면의 Alert를 Banner(기호 포함)로 바꾼 것이라 역할과 문구는 그대로다.
function NoticeBanner({
  variant = 'err',
  title,
  children,
}: {
  variant?: 'info' | 'ok' | 'warn' | 'err'
  title: string
  children?: ReactNode
}) {
  return (
    <Banner variant={variant}>
      <p className="font-bold">{title}</p>
      {children ? <div className="mt-1 text-sm text-muted">{children}</div> : null}
    </Banner>
  )
}

export default NoticeBanner
