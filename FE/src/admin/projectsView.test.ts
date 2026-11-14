import { expect, it } from 'vitest'
import { DEFAULT_VIEW, projectsPath } from './projectsView.ts'

it('leaves the query out when every field is the default', () => {
  expect(projectsPath(DEFAULT_VIEW)).toBe('/api/admin/projects')
})

it('writes only the fields that differ, and encodes the search text', () => {
  expect(projectsPath({ page: 2, q: '', status: 'all' })).toBe('/api/admin/projects?page=2')
  expect(projectsPath({ page: 1, q: 'my app&x', status: 'stopped' })).toBe('/api/admin/projects?q=my+app%26x&status=stopped')
})
