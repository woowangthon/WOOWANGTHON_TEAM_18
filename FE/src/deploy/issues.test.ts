import { expect, it } from 'vitest'
import { issueMap, issueText, withoutField } from './issues.ts'

it('turns a code into a sentence and falls back for a code it does not know', () => {
  expect(issueText('RESERVED')).toBe('예약된 이름이라 쓸 수 없어요')
  expect(issueText('SLUG_TAKEN')).toBe('이미 다른 배포가 쓰는 이름이에요')
  expect(issueText('SOMETHING_NEW')).toBe('값을 확인해 주세요')
})

it('keeps the first code for a path', () => {
  const map = issueMap([
    { path: 'project.slug', code: 'RESERVED' },
    { path: 'project.slug', code: 'INVALID_VALUE' },
  ])
  expect(map.get('project.slug')).toBe('예약된 이름이라 쓸 수 없어요')
})

it('picks the paths that have no input on the screen', () => {
  const issues = [
    { path: 'services', code: 'OUT_OF_RANGE' },
    { path: 'project.repo', code: 'MISMATCH' },
    { path: 'services[0].runtime.stripPrefix', code: 'INVALID_TYPE' },
    { path: 'services[1].runtime.resources', code: 'INVALID_VALUE' },
    { path: 'services[0].name', code: 'REQUIRED' },
    { path: 'project.slug', code: 'RESERVED' },
  ]
  expect(withoutField(issues).map((i) => i.path)).toEqual(['services', 'project.repo', 'services[0].runtime.stripPrefix', 'services[1].runtime.resources'])
})
