// 운영자 서비스 목록의 보기 조건(쪽 · 검색 · 상태). 서버가 이 조건으로 거르고 쪽으로 나눈다(docs/design/api.md `GET /api/admin/projects`).
export type StatusFilter = 'all' | 'running' | 'stopped'
export type ProjectsView = { page: number; q: string; status: StatusFilter }

export const DEFAULT_VIEW: ProjectsView = { page: 1, q: '', status: 'all' }

// 기본값인 칸은 쿼리에 싣지 않는다(서버 기본과 같다).
export function projectsPath({ page, q, status }: ProjectsView) {
  const params = new URLSearchParams()
  if (page > 1) params.set('page', String(page))
  if (q !== '') params.set('q', q)
  if (status !== 'all') params.set('status', status)
  const query = params.toString()
  return query === '' ? '/api/admin/projects' : `/api/admin/projects?${query}`
}
