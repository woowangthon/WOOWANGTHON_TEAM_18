import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import DeployStages from './DeployStages.tsx'
import type { StageKey, StageState } from './stages.ts'

const ORDER: StageKey[] = ['intake', 'analysis', 'config', 'secrets', 'build', 'deploy', 'verify', 'done']
// 단계마다 상태를 적는다. 적지 않은 단계는 pending이다.
const show = (states: Partial<Record<StageKey, StageState>>) => {
  const all = Object.fromEntries(ORDER.map((key) => [key, states[key] ?? 'pending'])) as Record<StageKey, StageState>
  render(<DeployStages states={all} />)
}
const items = () => within(screen.getByRole('list', { name: '배포 단계' })).getAllByRole('listitem')
// 마지막 칸이 이름과 상태 글자다(앞 칸은 단계 번호 점).
const textOf = (li: HTMLElement) => li.lastElementChild?.textContent
const texts = () => items().map(textOf)

it('lists the eight stages of FR-060 in workflow order with a word for each state', () => {
  show({ intake: 'done', analysis: 'done', config: 'done', secrets: 'done', build: 'active' })
  expect(texts()).toEqual([
    '접수 (완료)',
    '분석 (완료)',
    '배포 설정 (완료)',
    '비밀값 (완료)',
    '빌드진행 중',
    '배포 (예정)',
    '동작 확인 (예정)',
    '완료 (예정)',
  ])
})

it('says every state in the five words of Steps plus a note, so colour is never the only signal', () => {
  const cases: [StageState, string][] = [
    ['pending', ' (예정)'],
    ['queued', ' (예정)배포 대기'],
    ['active', '진행 중'],
    ['done', ' (완료)'],
    ['skipped', ' (예정)건너뜀'],
    ['fixing', '진행 중문제 해결 중'],
    ['action', '입력 대기사용자 조치 필요'],
    ['failed', '실패'],
  ]
  for (const [state, label] of cases) {
    const { unmount } = render(
      <DeployStages states={{ ...Object.fromEntries(ORDER.map((k) => [k, 'pending'])), build: state } as Record<StageKey, StageState>} />,
    )
    expect(textOf(items()[4])).toBe(`빌드${label}`)
    unmount()
  }
})

it('points at the running and waiting-for-you stages for assistive technology, and at no other', () => {
  show({ intake: 'done', analysis: 'skipped', build: 'fixing', deploy: 'queued', verify: 'pending' })
  const marked = items().filter((li) => li.getAttribute('aria-current') === 'step')
  expect(marked.map(textOf)).toEqual(['빌드진행 중문제 해결 중'])
})

it('can show a stage after a later one is active again (a retry), since the parent decides the states', () => {
  show({ intake: 'done', analysis: 'done', config: 'done', secrets: 'done', build: 'active', deploy: 'done' })
  expect(texts().slice(4, 6)).toEqual(['빌드진행 중', '배포 (완료)'])
})

it('shows the finished deploy with every stage done and nothing marked current', () => {
  show(Object.fromEntries(ORDER.map((key) => [key, 'done'])))
  expect(texts().every((text) => text?.endsWith('(완료)'))).toBe(true)
  expect(items().some((li) => li.getAttribute('aria-current'))).toBe(false)
})

it('shows a failed stage with the later stages still waiting', () => {
  show({ intake: 'done', analysis: 'done', config: 'done', secrets: 'done', build: 'failed' })
  expect(texts().slice(4)).toEqual(['빌드실패', '배포 (예정)', '동작 확인 (예정)', '완료 (예정)'])
})
