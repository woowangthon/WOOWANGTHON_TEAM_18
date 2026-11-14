import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api.ts'
import { WithQuery } from '../test-utils.tsx'
import IncidentNotice from './IncidentNotice.tsx'
import type { Incident } from './types.ts'
import { INCIDENTS_POLL_MS } from './useIncidents.ts'

// 실제 BE를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  apiFetch: api.apiFetch,
}))

const incident = (over: Partial<Incident> = {}): Incident => ({
  id: 'i-1',
  slug: 'shop',
  alertname: 'PodMemoryHigh',
  title: '메모리 사용량이 너무 높아요',
  state: 'firing',
  firedAt: '2026-11-14T01:00:00.000Z',
  resolvedAt: null,
  action: 'pending',
  ai: { status: 'done', risk: 'high', recommendation: 'stop', cause: null, reason: null, model: 'local' },
  decidedAt: null,
  evidence: null,
  ...over,
})
const deploys = [
  { id: 'd-shop', slug: 'shop' },
  { id: 'd-blog', slug: 'blog' },
]

let incidents: Incident[] | Error
beforeEach(() => {
  vi.useFakeTimers()
  incidents = []
  api.apiFetch.mockReset().mockImplementation((path: string) => {
    if (path === '/api/deploys') return Promise.resolve({ deploys })
    if (incidents instanceof Error) return Promise.reject(incidents)
    return Promise.resolve({ incidents })
  })
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
const show = async (deployId?: string) => {
  render(
    <WithQuery>
      <IncidentNotice deployId={deployId} />
    </WithQuery>,
  )
  await advance(0)
}
const reads = () => api.apiFetch.mock.calls.filter((c) => c[0] === '/api/incidents').length

it('says a service was stopped as an error, for an automatic stop and for an operator stop', async () => {
  incidents = [incident({ id: 'a', action: 'auto_stopped' }), incident({ id: 'b', slug: 'blog', action: 'stopped' })]
  await show()
  expect(screen.getAllByRole('alert')).toHaveLength(2)
  expect(screen.getAllByText('서비스를 멈췄어요')).toHaveLength(2)
  expect(screen.getAllByText('메모리 사용량이 너무 높아요', { exact: false })).toHaveLength(2)
})

it('says an open alert as a warning, not an error', async () => {
  incidents = [incident()]
  await show()
  expect(screen.getByText('운영 알림')).toBeTruthy()
  expect(screen.getByRole('status').textContent).toContain('shop')
  expect(screen.queryByRole('alert')).toBeNull()
})

it('adds one line with the AI cause when there is one, as plain text', async () => {
  incidents = [incident({ ai: { ...incident().ai, cause: '<b>메모리 누수</b>가 의심돼요' } })]
  await show()
  expect(screen.getByText(/AI가 본 원인: <b>메모리 누수<\/b>가 의심돼요/)).toBeTruthy()
  expect(document.querySelector('b')).toBeNull()
})

it('shows no AI line without a cause', async () => {
  incidents = [incident()]
  await show()
  expect(screen.queryByText(/AI가 본 원인/)).toBeNull()
})

it('shows nothing for a dismissed alert or a resolved one that is still waiting', async () => {
  incidents = [incident({ id: 'a', action: 'dismissed' }), incident({ id: 'b', state: 'resolved', resolvedAt: '2026-11-14T02:00:00.000Z' })]
  await show()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('status')).toBeNull()
})

it('shows only the alerts of the project of the given deploy', async () => {
  incidents = [incident({ id: 'a', slug: 'shop', title: '가게 알림' }), incident({ id: 'b', slug: 'blog', title: '블로그 알림' })]
  await show('d-blog')
  expect(screen.getByText(/블로그 알림/)).toBeTruthy()
  expect(screen.queryByText(/가게 알림/)).toBeNull()
})

it('shows nothing for a deploy whose project it cannot tell', async () => {
  incidents = [incident()]
  await show('d-unknown')
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('reads again every 30 seconds and shows a newly stopped service', async () => {
  await show()
  expect(reads()).toBe(1)
  incidents = [incident({ action: 'auto_stopped' })]
  await advance(INCIDENTS_POLL_MS - 1)
  expect(reads()).toBe(1)
  await advance(1)
  expect(reads()).toBe(2)
  expect(screen.getByText('서비스를 멈췄어요')).toBeTruthy()
})

it('shows nothing, not an error, when the alerts cannot be read', async () => {
  incidents = new ApiError(503, 'DATABASE_UNAVAILABLE', 'x')
  await show()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('status')).toBeNull()
})

it('shows why the service stopped with the kept log lines', async () => {
  const evidence = { pod: 'shop-a-1', restarts: 3, waiting: null, lastExit: { reason: 'OOMKilled', exitCode: 137 }, logs: ['line 1'] }
  incidents = [incident({ action: 'auto_stopped', evidence })]
  await show()
  expect(screen.getByText('알림 근거: 재시작 3번 · 마지막 종료: OOMKilled (코드 137)')).toBeTruthy()
  expect(screen.getByText('로그 마지막 1줄')).toBeTruthy()
})

it('closes a banner with X and keeps it closed after the page is opened again', async () => {
  incidents = [incident({ id: 'a', action: 'auto_stopped' }), incident({ id: 'b', slug: 'blog' })]
  const { unmount } = render(
    <WithQuery>
      <IncidentNotice />
    </WithQuery>,
  )
  await advance(0)
  fireEvent.click(screen.getAllByRole('button', { name: '알림 닫기' })[0])
  expect(screen.queryByText('서비스를 멈췄어요')).toBeNull()
  expect(screen.getByText('운영 알림')).toBeTruthy()
  unmount()
  await show()
  expect(screen.queryByText('서비스를 멈췄어요')).toBeNull()
  expect(screen.getByText('운영 알림')).toBeTruthy()
})

it('keeps what another tab closed in the meantime when closing a banner', async () => {
  incidents = [incident({ id: 'a', action: 'auto_stopped' })]
  render(
    <WithQuery>
      <IncidentNotice />
    </WithQuery>,
  )
  await advance(0)
  localStorage.setItem('wcp.closedIncidents', JSON.stringify(['other-tab']))
  fireEvent.click(screen.getByRole('button', { name: '알림 닫기' }))
  expect(JSON.parse(localStorage.getItem('wcp.closedIncidents') ?? '[]')).toEqual(['other-tab', 'a'])
})
