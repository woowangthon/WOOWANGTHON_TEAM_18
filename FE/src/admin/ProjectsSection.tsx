import { useEffect, useState } from 'react'
import { Button } from '../components/ui/Button.tsx'
import { Field } from '../components/ui/Field.tsx'
import AdminSection from './AdminSection.tsx'
import ProjectCard from './ProjectCard.tsx'
import type { ProjectsView, StatusFilter } from './projectsView.ts'
import type { AdminRead } from './useAdminRead.ts'
import type { ProjectsResponse } from './types.ts'

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'running', label: '실행 중' },
  { value: 'stopped', label: '중지됨' },
]
const MAX_SEARCH = 100

type Props = { read: AdminRead<ProjectsResponse>; view: ProjectsView; onView: (view: ProjectsView) => void; onForbidden: () => void }

// 검색(slug · 레포)과 상태 거르기. 조건이 바뀌면 첫 쪽부터 다시 읽는다.
function Toolbar({ view, onView }: Pick<Props, 'view' | 'onView'>) {
  const [draft, setDraft] = useState(view.q)
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <form
        role="search"
        className="flex flex-1 items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          onView({ ...view, page: 1, q: draft.trim() })
        }}
      >
        <div className="flex-1">
          <Field label="slug · 레포 검색" value={draft} maxLength={MAX_SEARCH} onChange={(event) => { setDraft(event.target.value) }} />
        </div>
        <Button type="submit" variant="outline">
          검색
        </Button>
      </form>
      <div role="group" aria-label="상태로 거르기" className="flex gap-2">
        {FILTERS.map(({ value, label }) => (
          <Button
            key={value}
            variant={view.status === value ? 'primary' : 'outline'}
            aria-pressed={view.status === value}
            onClick={() => {
              onView({ ...view, page: 1, status: value })
            }}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}

function Pager({ data, view, onView }: { data: ProjectsResponse } & Pick<Props, 'view' | 'onView'>) {
  const last = Math.max(1, Math.ceil(data.total / data.pageSize))
  // 정리해서 마지막 쪽이 비었으면 마지막 쪽으로 돌아간다.
  useEffect(() => {
    if (data.total > 0 && data.page > last) onView({ ...view, page: last })
  }, [data.total, data.page, last, view, onView])
  return (
    <nav aria-label="서비스 목록 쪽" className="flex flex-wrap items-center gap-2 text-sm">
      <Button
        variant="outline"
        disabled={data.page <= 1}
        onClick={() => {
          onView({ ...view, page: data.page - 1 })
        }}
      >
        이전
      </Button>
      <span aria-live="polite">
        {data.page} / {last}쪽 · 총 {data.total}개
      </span>
      <Button
        variant="outline"
        disabled={data.page >= last}
        onClick={() => {
          onView({ ...view, page: data.page + 1 })
        }}
      >
        다음
      </Button>
    </nav>
  )
}

// 실행 중인 서비스(FR-083 · FR-084 · FR-104). 최근에 배포를 저장한 프로젝트부터 서버가 준 순서 그대로다. 검색 · 거르기 · 쪽 나누기는 서버가 한다.
function ProjectsSection({ read, view, onView, onForbidden }: Props) {
  const filtered = view.q !== '' || view.status !== 'all'
  return (
    <AdminSection
      id="services-heading"
      title="실행 중인 서비스"
      read={read}
      failed="서비스 목록을 읽지 못했어요"
      loading="서비스 목록을 불러오는 중…"
      empty={filtered ? '조건에 맞는 서비스가 없어요.' : '저장된 배포가 없어요.'}
      isEmpty={(data) => data.projects.length === 0 && data.total === 0}
      toolbar={<Toolbar key={view.q} view={view} onView={onView} />}
    >
      {(data) => (
        <>
          <ul className="flex flex-col gap-3">
            {data.projects.map((project) => (
              <ProjectCard key={project.slug} project={project} onStopped={read.reload} onForbidden={onForbidden} />
            ))}
          </ul>
          <Pager data={data} view={view} onView={onView} />
        </>
      )}
    </AdminSection>
  )
}

export default ProjectsSection
