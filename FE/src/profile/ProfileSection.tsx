import type { ReactNode } from 'react'
import { Card } from '../components/ui/Card.tsx'

// 프로필의 한 구역. 위쪽 구역 메뉴가 id로 건너뛴다.
function ProfileSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex scroll-mt-4 flex-col gap-3">
      <h2 id={`${id}-heading`} className="text-lg">
        {title}
      </h2>
      <Card className="flex flex-col gap-4 p-6">{children}</Card>
    </section>
  )
}

export default ProfileSection
