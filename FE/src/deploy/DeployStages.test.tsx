import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import DeployStages from './DeployStages.tsx'
import type { StageCondition, StageKey } from './stages.ts'

const ORDER = ['접수', '분석', '배포 설정', '비밀값', '빌드', '배포', '동작 확인', '완료']
const items = () => within(screen.getByRole('list', { name: '배포 단계' })).getAllByRole('listitem')
const labelsOf = () => items().map((li) => li.textContent)
const show = (current: StageKey, condition?: StageCondition) => render(<DeployStages current={current} condition={condition} />)

it('lists the eight stages of FR-060 in workflow order', () => {
  show('received')
  expect(items().map((li) => ORDER.find((name) => li.textContent.startsWith(name)))).toEqual(ORDER)
})

it('marks earlier stages as done, the current one as in progress and later ones as waiting', () => {
  show('build')
  expect(labelsOf()).toEqual([
    '접수끝남',
    '분석끝남',
    '배포 설정끝남',
    '비밀값끝남',
    '빌드진행 중',
    '배포대기',
    '동작 확인대기',
    '완료대기',
  ])
})

it('points at the current stage for assistive technology, and only that one', () => {
  show('deploy')
  expect(items().filter((li) => li.getAttribute('aria-current') === 'step').map((li) => li.textContent)).toEqual(['배포진행 중'])
})

it('shows everything as done once the last stage is reached', () => {
  show('done')
  expect(items().every((li) => li.textContent.endsWith('끝남'))).toBe(true)
  expect(screen.queryByText('진행 중')).toBeNull()
  expect(screen.queryByText('대기')).toBeNull()
})

it.each([
  ['waiting', '배포 대기'],
  ['fixing', '문제 해결 중'],
  ['action', '사용자 조치 필요'],
  ['failed', '실패'],
] as const)('puts the %s state on the current stage in words, replacing "진행 중"', (condition, label) => {
  show('build', condition)
  expect(items()[4]?.textContent).toBe(`빌드${label}`)
  expect(screen.queryByText('진행 중')).toBeNull()
  expect(items()[3]?.textContent).toBe('비밀값끝남')
  expect(items()[5]?.textContent).toBe('배포대기')
})

it('does not call the last stage done while a condition is on it', () => {
  show('done', 'failed')
  expect(items()[7]?.textContent).toBe('완료실패')
})
