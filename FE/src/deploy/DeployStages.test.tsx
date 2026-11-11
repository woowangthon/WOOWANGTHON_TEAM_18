import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import DeployStages from './DeployStages.tsx'
import type { StageKey, StageState } from './stages.ts'

const ORDER: StageKey[] = ['received', 'analysis', 'spec', 'secrets', 'build', 'deploy', 'verify', 'done']
// 단계마다 상태를 적는다. 적지 않은 단계는 pending이다.
const show = (states: Partial<Record<StageKey, StageState>>) => {
  const all = Object.fromEntries(ORDER.map((key) => [key, states[key] ?? 'pending'])) as Record<StageKey, StageState>
  render(<DeployStages states={all} />)
}
const items = () => within(screen.getByRole('list', { name: '배포 단계' })).getAllByRole('listitem')
const texts = () => items().map((li) => li.textContent)

it('lists the eight stages of FR-060 in workflow order with a word for each state', () => {
  show({ received: 'done', analysis: 'done', spec: 'done', secrets: 'done', build: 'active' })
  expect(texts()).toEqual([
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

it('says every state in words, so colour is never the only signal', () => {
  const cases: [StageState, string][] = [
    ['pending', '대기'],
    ['queued', '배포 대기'],
    ['active', '진행 중'],
    ['done', '끝남'],
    ['skipped', '건너뜀'],
    ['fixing', '문제 해결 중'],
    ['action', '사용자 조치 필요'],
    ['failed', '실패'],
  ]
  for (const [state, label] of cases) {
    const { unmount } = render(
      <DeployStages states={{ ...Object.fromEntries(ORDER.map((k) => [k, 'pending'])), build: state } as Record<StageKey, StageState>} />,
    )
    expect(items()[4]?.textContent).toBe(`빌드${label}`)
    unmount()
  }
})

it('points at the stages that need attention for assistive technology, and at no other', () => {
  show({ received: 'done', analysis: 'skipped', build: 'fixing', deploy: 'queued', verify: 'pending' })
  const marked = items().filter((li) => li.getAttribute('aria-current') === 'step')
  expect(marked.map((li) => li.textContent)).toEqual(['빌드문제 해결 중', '배포배포 대기'])
})

it('can show a stage after a later one is active again (a retry), since the parent decides the states', () => {
  show({ received: 'done', analysis: 'done', spec: 'done', secrets: 'done', build: 'active', deploy: 'done' })
  expect(texts().slice(4, 6)).toEqual(['빌드진행 중', '배포끝남'])
})

it('shows the finished deploy with every stage done and nothing marked current', () => {
  show(Object.fromEntries(ORDER.map((key) => [key, 'done'])))
  expect(texts().every((text) => text.endsWith('끝남'))).toBe(true)
  expect(items().some((li) => li.getAttribute('aria-current'))).toBe(false)
})

it('shows a failed stage with the later stages still waiting', () => {
  show({ received: 'done', analysis: 'done', spec: 'done', secrets: 'done', build: 'failed' })
  expect(texts().slice(4)).toEqual(['빌드실패', '배포대기', '동작 확인대기', '완료대기'])
})
