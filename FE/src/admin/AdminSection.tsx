import type { ReactNode } from 'react'
import { ClusterProblem } from './ClusterProblem.tsx'
import type { AdminRead } from './useAdminRead.ts'

type AdminSectionProps<T> = {
  id: string
  // 바로가기 링크가 건너뛸 구역의 id(선택). 제목 id(id)와 따로 둔다.
  anchor?: string
  title: string
  read: AdminRead<T>
  // 읽지 못했을 때의 제목 · 불러오는 중 · 비어 있을 때의 글. isEmpty가 참이면 children 대신 empty를 보인다.
  failed: string
  loading: string
  empty: string
  isEmpty: (data: T) => boolean
  children: (data: T) => ReactNode
}

// 운영자 화면의 구역 하나. 읽기가 실패해도 마지막으로 읽은 값은 그대로 보이고, 실패는 그 위에 따로 알린다.
function AdminSection<T>({ id, anchor, title, read, failed, loading, empty, isEmpty, children }: AdminSectionProps<T>) {
  const { data, error } = read
  return (
    <section id={anchor} aria-labelledby={id} className="flex scroll-mt-4 flex-col gap-3">
      <h2 id={id} className="text-lg">
        {title}
      </h2>
      {error !== null && <ClusterProblem error={error} stale={data !== null} fallback={failed} />}
      {data === null && error === null && (
        <p role="status" className="text-sm text-muted">
          {loading}
        </p>
      )}
      {data !== null && (isEmpty(data) ? <p className="text-sm text-muted">{empty}</p> : children(data))}
    </section>
  )
}

export default AdminSection
