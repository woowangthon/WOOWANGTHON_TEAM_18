import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api.ts'
import { WithQuery } from '../test-utils.tsx'
import ServiceStatus from './ServiceStatus.tsx'
import type { Metrics, MetricsService } from './metrics.ts'

// 실제 BE를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  apiFetch: api.apiFetch,
}))

const ID = '0b6f0c1e-4a52-4d8e-9a1b-3f7d2c5e8a90'
const PATH = `/api/deploys/${ID}/metrics`
const NOT_COLLECTED = '아직 수집하지 못했어요'

const fe: MetricsService = {
  name: 'fe',
  deployment: 'fe-a',
  state: 'running',
  waiting: null,
  replicas: 1,
  readyReplicas: 1,
  restarts: 0,
  usage: { cpuMillicores: 40, memoryBytes: 73_400_320 },
}
const T = 1_794_540_000
const liveWith = (services: MetricsService[], overrides: Partial<Metrics> = {}): Metrics => ({
  deployId: ID,
  slug: 'my-app',
  state: 'live',
  reason: null,
  slot: 'a',
  services,
  usageStatus: 'collected',
  series: {
    status: 'collected',
    endT: T + 60,
    windowSeconds: 3600,
    stepSeconds: 60,
    services: services.map((s) => ({
      name: s.name,
      cpuMillicores: [{ t: T, v: 38 }, { t: T + 60, v: 41 }],
      memoryBytes: [{ t: T, v: 73_400_320 }, { t: T + 60, v: 73_465_856 }],
    })),
  },
  ...overrides,
})
const notLive = (reason: 'superseded' | 'not_succeeded'): Metrics => ({
  deployId: ID,
  slug: 'my-app',
  state: 'not_live',
  reason,
  slot: null,
  services: [],
  usageStatus: null,
  series: null,
})

beforeEach(() => {
  vi.useFakeTimers()
  api.apiFetch.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
const show = async () => {
  const view = render(
    <WithQuery>
      <MemoryRouter>
        <ServiceStatus deployId={ID} />
      </MemoryRouter>
    </WithQuery>,
  )
  await advance(0)
  return view
}
const reads = () => api.apiFetch.mock.calls.filter((c) => c[0] === PATH).length
const card = () => within(screen.getByRole('region', { name: '서비스 상태' }))

it('shows a running service with its restarts since now, current use and two graphs', async () => {
  api.apiFetch.mockResolvedValue(liveWith([fe]))
  await show()
  expect(api.apiFetch).toHaveBeenCalledWith(PATH)
  expect(card().getByText('fe')).toBeTruthy()
  expect(card().getByText('실행 중(정상)')).toBeTruthy()
  // "최근 1시간 동안"이 아니다. 새 배포나 교체 뒤에는 0으로 돌아가는 값이다.
  expect(card().getByText(/다시 시작된 횟수/).textContent).toBe('다시 시작된 횟수 0번 (지금 실행 이후)')
  expect(card().getByText('0.04코어')).toBeTruthy()
  expect(card().getByText('70MiB')).toBeTruthy()
  expect(card().getByRole('img', { name: /^fe CPU 사용량\(최근 1시간\): 최저 0.04코어 · 최고 0.04코어 · 지금 0.04코어$/ })).toBeTruthy()
  expect(card().getByRole('img', { name: /^fe 메모리 사용량\(최근 1시간\)/ })).toBeTruthy()
})

it('says a newer deploy is live and links to the list, without making the card look like an error', async () => {
  api.apiFetch.mockResolvedValue(notLive('superseded'))
  await show()
  expect(card().getByText(/더 새 배포가 공개 중이에요/)).toBeTruthy()
  expect(card().getByRole('link', { name: '내 배포 목록으로 가기' }).getAttribute('href')).toBe('/deploys')
  expect(screen.queryByRole('alert')).toBeNull()
})

it('says a deploy that did not succeed is not public yet', async () => {
  api.apiFetch.mockResolvedValue(notLive('not_succeeded'))
  await show()
  expect(card().getByText('이 배포는 아직 공개 중이 아니에요.')).toBeTruthy()
})

it('explains why a service keeps restarting in plain words', async () => {
  api.apiFetch.mockResolvedValue(
    liveWith([{ ...fe, state: 'starting', waiting: 'CrashLoopBackOff', readyReplicas: 0, restarts: 4, usage: null }]),
  )
  await show()
  expect(card().getByText('헬스 체크 대기 중')).toBeTruthy()
  expect(card().getByText('시작하자마자 계속 꺼지고 있어요')).toBeTruthy()
  expect(card().getByText(/다시 시작된 횟수/).textContent).toBe('다시 시작된 횟수 4번 (지금 실행 이후)')
  expect(screen.queryByText(/CrashLoopBackOff/)).toBeNull()
})

it('says getting ready for a waiting reason it does not know, and stopped as off', async () => {
  api.apiFetch.mockResolvedValue(
    liveWith([
      { ...fe, state: 'starting', waiting: 'SomethingNew', readyReplicas: 0 },
      { ...fe, name: 'be', deployment: 'be-a', state: 'stopped', replicas: 0, readyReplicas: 0, usage: null },
    ]),
  )
  await show()
  expect(card().getByText('준비 중이에요')).toBeTruthy()
  expect(card().getByText('중지됨')).toBeTruthy()
})

it('shows not collected, with no zero and no fake line, when usage and series were not collected', async () => {
  api.apiFetch.mockResolvedValue(
    liveWith([{ ...fe, usage: null }], { usageStatus: 'not_collected', series: { status: 'not_collected', endT: T + 60, windowSeconds: 3600, stepSeconds: 60, services: [] } }),
  )
  await show()
  expect(card().getByText(`지금 사용량: ${NOT_COLLECTED}`)).toBeTruthy()
  expect(card().getByText(`최근 1시간 그래프: ${NOT_COLLECTED}`)).toBeTruthy()
  expect(card().queryByRole('img')).toBeNull()
  expect(card().queryByText(/코어|MiB/)).toBeNull()
})

it('shows not collected for a service with no points yet instead of drawing a line', async () => {
  api.apiFetch.mockResolvedValue(
    liveWith([fe], { series: { status: 'collected', endT: T + 60, windowSeconds: 3600, stepSeconds: 60, services: [{ name: 'fe', cpuMillicores: [], memoryBytes: [] }] } }),
  )
  await show()
  expect(card().getByText(`fe CPU 사용량(최근 1시간): ${NOT_COLLECTED}`)).toBeTruthy()
  expect(card().getByText(`fe 메모리 사용량(최근 1시간): ${NOT_COLLECTED}`)).toBeTruthy()
  expect(card().queryByRole('img')).toBeNull()
})

it('leaves a gap in the line for a minute with no point instead of joining across it', async () => {
  api.apiFetch.mockResolvedValue(
    liveWith([fe], {
      series: {
        status: 'collected',
        endT: T + 180,
        windowSeconds: 3600,
        stepSeconds: 60,
        services: [{ name: 'fe', cpuMillicores: [{ t: T, v: 10 }, { t: T + 180, v: 20 }], memoryBytes: [{ t: T, v: 1048576 }] }],
      },
    }),
  )
  await show()
  const cpu = card().getByRole('img', { name: /^fe CPU 사용량/ })
  expect(cpu.querySelectorAll('path')).toHaveLength(2)
})

it('says it could not read, keeps the last values and keeps trying, on 503 CLUSTER_UNAVAILABLE', async () => {
  api.apiFetch
    .mockResolvedValueOnce(liveWith([fe]))
    .mockRejectedValueOnce(new ApiError(503, 'CLUSTER_UNAVAILABLE', 'x'))
    .mockResolvedValue(liveWith([fe]))
  await show()
  await advance(15000)
  // 오류가 아니라 기다렸다 읽는 안내(status)다.
  const notice = card().getByText('지금 상태를 읽지 못했어요').closest('[role=status]')
  expect(notice?.textContent).toContain('잠시 뒤에 다시 읽어요')
  expect(card().getByText('실행 중(정상)')).toBeTruthy()
  await advance(15000)
  expect(card().queryByText('지금 상태를 읽지 못했어요')).toBeNull()
  expect(reads()).toBe(3)
})

it('reads again every 15 seconds while the deploy is live, not sooner', async () => {
  api.apiFetch.mockResolvedValue(liveWith([fe]))
  await show()
  await advance(14999)
  expect(reads()).toBe(1)
  await advance(1)
  expect(reads()).toBe(2)
})

it('stops reading once the answer says this deploy is not live', async () => {
  api.apiFetch.mockResolvedValue(notLive('superseded'))
  await show()
  await advance(60000)
  expect(reads()).toBe(1)
})

it('stops reading when the component goes away', async () => {
  api.apiFetch.mockResolvedValue(liveWith([fe]))
  const { unmount } = await show()
  unmount()
  await advance(60000)
  expect(reads()).toBe(1)
})

it('draws no card for a deploy the server does not know (the page above already says so)', async () => {
  api.apiFetch.mockRejectedValue(new ApiError(404, 'DEPLOY_NOT_FOUND', 'x'))
  await show()
  expect(screen.queryByRole('region', { name: '서비스 상태' })).toBeNull()
  await advance(60000)
  expect(reads()).toBe(1)
})
