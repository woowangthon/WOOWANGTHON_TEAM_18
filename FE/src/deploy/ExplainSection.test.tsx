import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import ExplainSection from './ExplainSection.tsx'
import { explanationOf } from './fixtures.ts'
import type { Progress } from './progress.ts'

const progressOf = (extra: Partial<Progress> = {}): Progress => ({
  deployId: 'd1',
  status: 'succeeded',
  stage: null,
  steps: [],
  failure: null,
  url: null,
  warnings: [],
  updatedAt: '2026-11-11T01:00:00.000Z',
  ...extra,
})
const ready = (extra = {}) => progressOf({ explanation: { state: 'ready', content: explanationOf(extra) } })
const AI = 'AI 배포 설명'
const GUIDE = '배포 단계 안내'

it('shows every part of a ready explanation', () => {
  render(
    <ExplainSection
      progress={ready({
        cause: '포트가 맞지 않았을 가능성이 커요',
        actions: ['포트를 확인해요', '다시 배포해요'],
        terms: [{ term: '슬롯', meaning: 'A 또는 B 자리' }],
      })}
    />,
  )
  const region = within(screen.getByRole('region', { name: AI }))
  expect(region.getByText('이번 배포는 새 슬롯에 올려 확인한 뒤 주소를 바꿨어요.')).toBeTruthy()
  expect(region.getByText('빌드')).toBeTruthy()
  expect(region.getByText(/이미지를 만들었어요/)).toBeTruthy()
  expect(region.getByText('코드가 컨테이너가 돼요')).toBeTruthy()
  expect(region.getByText('전환')).toBeTruthy()
  expect(region.getByText('그럴듯한 원인')).toBeTruthy()
  expect(region.getByText('포트가 맞지 않았을 가능성이 커요')).toBeTruthy()
  expect(region.getByText('다음에 할 일')).toBeTruthy()
  expect(region.getAllByRole('listitem').map((li) => li.textContent)).toEqual(expect.arrayContaining(['포트를 확인해요', '다시 배포해요']))
  expect(region.getByText(/틀릴 수 있어요/)).toBeTruthy()
  const details = region.getByText('용어 풀이').closest('details')
  expect(details).not.toBeNull()
  expect(within(details as HTMLElement).getByText('슬롯')).toBeTruthy()
  expect(within(details as HTMLElement).getByText('A 또는 B 자리')).toBeTruthy()
  expect(screen.queryByRole('region', { name: GUIDE })).toBeNull()
})

it('hides the cause, actions and terms when there are none', () => {
  render(<ExplainSection progress={ready()} />)
  expect(screen.queryByText('그럴듯한 원인')).toBeNull()
  expect(screen.queryByText('다음에 할 일')).toBeNull()
  expect(screen.queryByText('용어 풀이')).toBeNull()
  expect(screen.getByText(/틀릴 수 있어요/)).toBeTruthy()
})

it.each([
  ['null', { explanation: null }],
  ['missing', {}],
  ['failed', { explanation: { state: 'failed', content: null } }],
  ['skipped', { explanation: { state: 'skipped', content: null } }],
] as [string, Partial<Progress>][])('shows the static guide, not the AI explanation, when the explanation is %s', (_name, extra) => {
  render(<ExplainSection progress={progressOf(extra)} />)
  expect(screen.getByRole('region', { name: GUIDE })).toBeTruthy()
  expect(screen.queryByText(AI)).toBeNull()
  expect(screen.queryByRole('region', { name: AI })).toBeNull()
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getAllByRole('listitem')).toHaveLength(6)
})

it('shows only the stages that ran when the deploy failed', () => {
  render(<ExplainSection progress={progressOf({ status: 'failed', failure: { code: 'DEPLOY_FAILED', stage: 'apply', service: null, message: 'x' } })} />)
  expect(screen.getAllByRole('listitem').map((li) => li.querySelector('span')?.textContent)).toEqual(['빌드', '준비', '설정 확인', '올리기'])
})

it('says the AI is explaining while pending, and stops saying so once the wait is over', () => {
  const progress = progressOf({ explanation: { state: 'pending', content: null } })
  const { rerender } = render(<ExplainSection progress={progress} />)
  expect(screen.getByRole('status').textContent).toContain('AI가 이번 배포를 설명하는 중이에요')
  expect(screen.getByRole('region', { name: GUIDE })).toBeTruthy()
  expect(screen.queryByText(AI)).toBeNull()
  rerender(<ExplainSection progress={progress} waitOver />)
  expect(screen.queryByText(/설명하는 중/)).toBeNull()
  expect(screen.getByRole('region', { name: GUIDE })).toBeTruthy()
})
