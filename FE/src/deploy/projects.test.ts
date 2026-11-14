import { expect, it } from 'vitest'
import { filterProjects, groupProjects, sortProjects } from './projects.ts'
import type { DeployListItem } from './progress.ts'

const run = (slug: string, status: DeployListItem['status'], createdAt: string): DeployListItem => ({
  id: `${slug}-${createdAt}`,
  slug,
  repo: `me/${slug}`,
  commit: 'c',
  createdAt,
  status,
  stage: null,
  url: null,
})

const projects = groupProjects([
  run('shop', 'succeeded', '2026-11-13T10:00:00Z'),
  run('blog', 'running', '2026-11-14T10:00:00Z'),
  run('api', 'failed', '2026-11-12T10:00:00Z'),
  run('chat', 'needs_user', '2026-11-11T10:00:00Z'),
  run('draft', 'not_started', '2026-11-10T10:00:00Z'),
  run('wait', 'queued', '2026-11-09T10:00:00Z'),
  run('fix', 'fixing', '2026-11-08T10:00:00Z'),
])
const slugs = (list: { slug: string }[]) => list.map((p) => p.slug)

it('filters by the same groups the tiles count: running is succeeded, in progress is queued, running and fixing, attention is failed and needs_user', () => {
  expect(slugs(filterProjects(projects, 'running'))).toEqual(['shop'])
  expect(slugs(filterProjects(projects, 'inProgress'))).toEqual(['blog', 'wait', 'fix'])
  expect(slugs(filterProjects(projects, 'needsAttention'))).toEqual(['api', 'chat'])
})

it('keeps every project, including one not started, under "all"', () => {
  expect(filterProjects(projects, 'all')).toHaveLength(7)
})

it('sorts by latest deploy, newest first, and by name in Korean order without changing the given array', () => {
  const before = slugs(projects)
  expect(slugs(sortProjects(projects, 'recent'))).toEqual(['blog', 'shop', 'api', 'chat', 'draft', 'wait', 'fix'])
  expect(slugs(sortProjects(projects, 'name'))).toEqual(['api', 'blog', 'chat', 'draft', 'fix', 'shop', 'wait'])
  expect(slugs(projects)).toEqual(before)
})

it('sorts Korean names in dictionary order', () => {
  const korean = groupProjects([run('나나', 'succeeded', '2026-11-13T10:00:00Z'), run('가가', 'succeeded', '2026-11-12T10:00:00Z')])
  expect(slugs(sortProjects(korean, 'name'))).toEqual(['가가', '나나'])
})
