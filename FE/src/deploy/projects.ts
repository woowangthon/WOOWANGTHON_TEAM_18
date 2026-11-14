import type { DeployListItem } from './progress.ts'

// 프로젝트는 slug 하나다. 같은 slug의 배포 중 가장 최근 것이 그 프로젝트의 현재 모습이다.
export type Project = { slug: string; latest: DeployListItem; runs: number }

export type ProjectCounts = { total: number; running: number; inProgress: number; needsAttention: number }

// 최신 배포가 앞에 오도록 프로젝트를 만든다(서버가 최신순으로 주지만 순서를 믿지 않는다).
export function groupProjects(deploys: DeployListItem[]): Project[] {
  const bySlug = new Map<string, Project>()
  for (const deploy of deploys) {
    const known = bySlug.get(deploy.slug)
    if (!known) {
      bySlug.set(deploy.slug, { slug: deploy.slug, latest: deploy, runs: 1 })
    } else {
      known.runs += 1
      if (Date.parse(deploy.createdAt) > Date.parse(known.latest.createdAt)) known.latest = deploy
    }
  }
  return [...bySlug.values()].sort(
    (a, b) => Date.parse(b.latest.createdAt) - Date.parse(a.latest.createdAt),
  )
}

// 배포 완료(running) = 최신 배포가 완료. 진행 중 = queued · running · fixing. 확인 필요 = failed · needs_user.
// 시작 전(not_started)은 전체에만 든다. 알 수 없는 상태도 어느 칸에도 넣지 않는다(지어내지 않는다).
export function countProjects(projects: Project[]): ProjectCounts {
  const count = (statuses: string[]) =>
    projects.filter((project) => statuses.includes(project.latest.status)).length
  return {
    total: projects.length,
    running: count(FILTER_STATUSES.running),
    inProgress: count(FILTER_STATUSES.inProgress),
    needsAttention: count(FILTER_STATUSES.needsAttention),
  }
}

// 대시보드의 상태별 보기. 타일 숫자(countProjects)와 같은 모음을 쓴다.
// "중지"는 두지 않는다: 배포 목록 응답에는 운영자가 멈췄는지가 없어서(중지해도 최신 배포는 완료로 남는다) 지어낼 수 없다.
export type ProjectFilter = 'all' | 'running' | 'inProgress' | 'needsAttention'
export type ProjectSort = 'recent' | 'name'

// 함수 선언보다 아래에 있지만 countProjects는 불릴 때 읽으므로 괜찮다.
const FILTER_STATUSES: Record<Exclude<ProjectFilter, 'all'>, string[]> = {
  running: ['succeeded'],
  inProgress: ['queued', 'running', 'fixing'],
  needsAttention: ['failed', 'needs_user'],
}

export const filterProjects = (projects: Project[], filter: ProjectFilter): Project[] =>
  filter === 'all' ? projects : projects.filter((project) => FILTER_STATUSES[filter].includes(project.latest.status))

// 최근순은 groupProjects가 이미 만든 순서라 그대로 둔다. 이름순은 ko 순서로 새 배열을 만든다(받은 배열을 바꾸지 않는다).
export const sortProjects = (projects: Project[], sort: ProjectSort): Project[] =>
  sort === 'name' ? [...projects].sort((a, b) => a.slug.localeCompare(b.slug, 'ko')) : projects
