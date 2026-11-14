import type { ReactNode } from 'react'
import { ClusterProblem } from './ClusterProblem.tsx'
import type { AdminRead } from './useAdminRead.ts'

type AdminSectionProps<T> = {
  id: string
  title: string
  read: AdminRead<T>
  // 읽지 못했을 때의 제목 · 불러오는 중 · 비어 있을 때의 글. isEmpty가 참이면 children 대신 empty를 보인다.
  failed: string
  loading: string
  empty: string
  isEmpty: (data: T) => boolean
  // 제목 바로 아래에 늘 보이는 것(읽는 중 · 비어 있을 때도). 검색 · 거르기처럼 읽기 결과에 기대지 않는 조작을 둔다.
  toolbar?: ReactNode
  children: (data: T) => ReactNode
}

// 운영자 화면의 구역 하나. 읽기가 실패해도 마지막으로 읽은 값은 그대로 보이고, 실패는 그 위에 따로 알린다.
function AdminSection<T>({ id, title, read, failed, loading, empty, isEmpty, toolbar, children }: AdminSectionProps<T>) {
  const { data, error } = read
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="scroll-mt-4 text-lg">
        {title}
      </h2>
      {toolbar}
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
