import type { ReactNode } from 'react'
import { Card } from '../components/ui/Card.tsx'

// 프로필의 한 구역. 위쪽 구역 메뉴가 id로 건너뛴다. icon은 제목 곁의 그림이고 장식이라 읽지 않는다.
function ProfileSection({ id, title, icon, children }: { id: string; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex scroll-mt-4 flex-col gap-3">
      <h2 id={`${id}-heading`} className="flex items-center gap-2 text-lg">
        <span aria-hidden="true" className="text-muted">
          {icon}
        </span>
        {title}
      </h2>
      <Card className="flex flex-col gap-4 p-6">{children}</Card>
    </section>
  )
}

export default ProfileSection
