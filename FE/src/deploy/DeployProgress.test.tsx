import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api.ts'
import DeployProgress from './DeployProgress.tsx'
import { STAGES } from './stages.ts'
import type { DeployFailure, DeployStatus, Progress } from './progress.ts'

// 실제 BE를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  apiFetch: api.apiFetch,
}))

// 서비스 상태 카드는 자기 시험(ServiceStatus.test.tsx)이 있다. 여기서는 어느 상태에서 나오는지만 본다.
vi.mock('./ServiceStatus.tsx', () => ({ default: ({ deployId }: { deployId: string }) => <p>서비스 상태 카드 {deployId}</p> }))

// 운영 알림 배너는 자기 시험(incidents/IncidentNotice.test.tsx)이 있다. 여기서는 어느 배포의 것으로 부르는지만 본다.
vi.mock('../incidents/IncidentNotice.tsx', () => ({ default: ({ deployId }: { deployId: string }) => <p>운영 알림 {deployId}</p> }))

// 저장한 설정 · 지표 읽기는 자기 시험(ServiceMap.test.tsx · ServiceStatus.test.tsx)이 있다. 여기서는 화면이 그 값으로 무엇을 그리는지만 본다.
const reads = vi.hoisted((): { saved: unknown; metrics: unknown } => ({ saved: undefined, metrics: undefined }))
vi.mock('./useSavedDeploy.ts', () => ({ useSavedDeploy: () => ({ data: reads.saved }) }))
vi.mock('./useMetrics.ts', () => ({ useMetrics: () => ({ data: reads.metrics }) }))
vi.mock('./ServiceMap.tsx', () => ({ default: ({ status }: { status: string }) => <p>서비스 구성도 {status}</p> }))

const ID = '0b6f0c1e-4a52-4d8e-9a1b-3f7d2c5e8a90'
const STATUS = `/api/deploys/${ID}/status`
const START = `/api/deploys/${ID}/start`

const KEYS = STAGES.map((stage) => stage.key)
// active 단계 이름과 그 앞은 done, 뒤는 pending. failed면 그 단계를 failed로.
const stepsAt = (at: string | null, failed = false) =>
  KEYS.map((key, i) => ({
    key,
    state: at === null ? 'done' : i < (KEYS as string[]).indexOf(at) ? 'done' : key === at ? (failed ? 'failed' : 'active') : 'pending',
  }))
const progressOf = (status: DeployStatus, at: string | null, extra: Partial<Progress> = {}): Progress => ({
  deployId: ID,
  status,
  stage: null,
  steps: stepsAt(at, status === 'failed'),
  failure: null,
  url: null,
  warnings: [],
  updatedAt: '2026-11-11T01:00:00.000Z',
  ...extra,
})
const failureWith = (code: string, message = '빌드에 실패했어요'): DeployFailure => ({ code, stage: 'build', service: 'be', message })

beforeEach(() => {
  vi.useFakeTimers()
  api.apiFetch.mockReset()
  reads.saved = undefined
  reads.metrics = undefined
})
afterEach(() => {
  vi.useRealTimers()
})

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
const statusReads = () => api.apiFetch.mock.calls.filter((c) => c[0] === STATUS).length
const show = async () => {
  const view = render(
    <MemoryRouter>
      <DeployProgress deployId={ID} />
    </MemoryRouter>,
  )
  await advance(0)
  return view
}
// 단계 이름이 정확히 같은 줄의 글자. "배포"가 "배포 설정"에 걸리지 않게 이름 칸을 따로 본다.
const clickStart = async () => {
  fireEvent.click(screen.getByRole('button', { name: '배포 시작' }))
  await advance(0)
}
// 마지막 칸이 이름과 상태 글자다(앞 칸은 단계 번호 점). 이름은 그 칸의 첫 글자 덩어리다.
const stage = (name: string) =>
  screen.getAllByRole('listitem').find((li) => li.lastElementChild?.firstChild?.textContent === name)?.lastElementChild?.textContent

it('reads the status of this deploy and draws the stages from it', async () => {
  api.apiFetch.mockResolvedValue(progressOf('running', 'deploy'))
  await show()
  expect(api.apiFetch).toHaveBeenCalledWith(STATUS)
  expect(stage('빌드')).toBe('빌드 (완료)')
  expect(stage('배포')).toBe('배포진행 중')
  expect(stage('완료')).toBe('완료 (예정)')
})

it('shows a loading note until the first answer arrives', () => {
  api.apiFetch.mockReturnValue(new Promise(() => undefined))
  render(
    <MemoryRouter>
      <DeployProgress deployId={ID} />
    </MemoryRouter>,
  )
  expect(screen.getByText('진행 상태를 불러오는 중…')).toBeTruthy()
})

it('reads again every 3 seconds while running and shows the change', async () => {
  api.apiFetch.mockResolvedValueOnce(progressOf('running', 'build')).mockResolvedValue(progressOf('running', 'deploy'))
  await show()
  expect(stage('빌드')).toBe('빌드진행 중')
  await advance(2999)
  expect(statusReads()).toBe(1)
  await advance(1)
  expect(statusReads()).toBe(2)
  expect(stage('빌드')).toBe('빌드 (완료)')
})

it('keeps reading while a problem is being fixed', async () => {
  api.apiFetch.mockResolvedValue(progressOf('fixing', 'deploy', { failure: failureWith('DEPLOY_FAILED', '문제를 살펴보는 중이에요') }))
  await show()
  await advance(3000)
  expect(statusReads()).toBe(2)
  expect(stage('배포')).toBe('배포진행 중문제 해결 중')
  expect(screen.getByText('문제를 해결하는 중이에요')).toBeTruthy()
  expect(screen.getByText('문제를 살펴보는 중이에요')).toBeTruthy()
})

it('shows what the AI is doing while a problem is being fixed, from the tool name and counts only', async () => {
  api.apiFetch.mockResolvedValue(
    progressOf('fixing', 'deploy', { failure: failureWith('DEPLOY_FAILED', '문제를 살펴보는 중이에요'), agentProgress: { tool: 'read_repo', calls: 5, limit: 20, at: '2026-11-11T01:00:00.000Z' } }),
  )
  await show()
  expect(screen.getByText('AI가 레포 파일을 읽는 중 · 도구 5/20')).toBeTruthy()
})

it('says nothing about the AI when no call was seen yet, and shows an unknown tool by its name', async () => {
  api.apiFetch.mockResolvedValueOnce(progressOf('fixing', 'deploy', { agentProgress: null }))
  await show()
  expect(screen.queryByText(/AI가 .* · 도구/)).toBeNull()
  api.apiFetch.mockResolvedValue(progressOf('fixing', 'deploy', { agentProgress: { tool: 'new_tool', calls: 1, limit: 20, at: '2026-11-11T01:00:00.000Z' } }))
  await advance(3000)
  expect(screen.getByText('AI가 new_tool · 도구 1/20')).toBeTruthy()
})

it.each([
  ['succeeded', null],
  ['failed', 'build'],
  ['needs_user', 'secrets'],
  ['not_started', 'secrets'],
] as const)('stops reading once the status is %s', async (status, at) => {
  api.apiFetch.mockResolvedValue(progressOf(status, at, { url: 'https://x.stairnoworks.com', failure: failureWith('BUILD_FAILED') }))
  await show()
  await advance(30_000)
  expect(statusReads()).toBe(1)
})

it.each([
  [{ position: 2, waitingForRoom: false }, '앞에 2개 배포가 있어요. 차례가 되면 자동으로 시작해요.'],
  [{ position: 0, waitingForRoom: false }, '곧 자동으로 시작해요.'],
  [{ position: 1, waitingForRoom: true }, '클러스터에 자리가 날 때까지 기다리는 중이에요. 자리가 나면 자동으로 시작해요.'],
  [undefined, '곧 자동으로 시작해요.'],
])('shows a waiting deploy as waiting for its turn (%j) and keeps reading', async (queue, note) => {
  api.apiFetch.mockResolvedValue(progressOf('queued', 'build', { queue }))
  await show()
  expect(screen.getByText('배포 순서를 기다리고 있어요')).toBeTruthy()
  expect(screen.getByText(note)).toBeTruthy()
  expect(screen.getAllByText('배포 대기').length).toBeGreaterThan(0)
  expect(stage('빌드')).toBe('빌드 (예정)배포 대기')
  await advance(3000)
  expect(statusReads()).toBe(2)
})

it('stops reading when the user leaves the screen', async () => {
  api.apiFetch.mockResolvedValue(progressOf('running', 'build'))
  const { unmount } = await show()
  unmount()
  await advance(30_000)
  expect(statusReads()).toBe(1)
})

it('keeps the last state, says it is not the user fault and keeps trying when a read fails', async () => {
  api.apiFetch
    .mockResolvedValueOnce(progressOf('running', 'build'))
    .mockRejectedValueOnce(new ApiError(503, 'DATABASE_UNAVAILABLE', 'x'))
    .mockResolvedValue(progressOf('running', 'deploy'))
  await show()
  await advance(3000)
  expect(screen.getByText('서버와 연결하지 못했어요')).toBeTruthy()
  expect(stage('빌드')).toBe('빌드진행 중')
  await advance(3000)
  expect(screen.queryByText('서버와 연결하지 못했어요')).toBeNull()
  expect(stage('배포')).toBe('배포진행 중')
})

it.each([
  [new ApiError(500, 'INTERNAL', 'x')],
  [new ApiError(400, 'BAD_REQUEST', 'x')],
  [new TypeError('boom')],
])('stops reading on an error that will not get better (%s) and reads again when asked', async (error) => {
  api.apiFetch.mockRejectedValueOnce(error).mockResolvedValue(progressOf('running', 'build'))
  await show()
  expect(screen.getByText('진행 상태를 읽지 못했어요')).toBeTruthy()
  expect(screen.queryByText(/사용자 잘못이 아니에요/)).toBeNull()
  await advance(30_000)
  expect(statusReads()).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: '다시 읽기' }))
  await advance(0)
  expect(statusReads()).toBe(2)
  expect(screen.queryByText('진행 상태를 읽지 못했어요')).toBeNull()
  expect(stage('빌드')).toBe('빌드진행 중')
})

it('does not say it is reading every 3 seconds once it has stopped reading', async () => {
  api.apiFetch.mockResolvedValueOnce(progressOf('running', 'build')).mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'x'))
  await show()
  expect(screen.getByText('3초마다 새로 읽고 있어요')).toBeTruthy()
  await advance(3000)
  expect(screen.getByText('진행 상태를 읽지 못했어요')).toBeTruthy()
  expect(screen.queryByText('3초마다 새로 읽고 있어요')).toBeNull()
})

it('keeps reading on a status it does not know, and shows the value it got', async () => {
  const paused = 'paused' as DeployStatus
  api.apiFetch.mockResolvedValueOnce(progressOf(paused, null)).mockResolvedValue(progressOf('succeeded', null))
  await show()
  expect(screen.getByText('paused')).toBeTruthy()
  await advance(3000)
  expect(statusReads()).toBe(2)
  expect(screen.queryByText('paused')).toBeNull()
})

it('says the deploy was not found on 404 and does not keep reading', async () => {
  api.apiFetch.mockRejectedValue(new ApiError(404, 'DEPLOY_NOT_FOUND', 'x'))
  await show()
  expect(screen.getByText('배포를 찾을 수 없어요')).toBeTruthy()
  expect(screen.getByRole('link', { name: '내 배포 목록으로 가기' }).getAttribute('href')).toBe('/deploys')
  await advance(30_000)
  expect(statusReads()).toBe(1)
})

it('starts the deploy from the button, then reads the status again and follows it', async () => {
  api.apiFetch.mockImplementation((path: string) => {
    if (path === START) return Promise.resolve({ deployId: ID, status: 'running', stage: 'build', targetSlot: 'a' })
    return Promise.resolve(statusReads() <= 1 ? progressOf('not_started', 'secrets') : progressOf('running', 'build'))
  })
  await show()
  expect(stage('비밀값')).toBe('비밀값입력 대기사용자 조치 필요')
  await clickStart()
  expect(api.apiFetch).toHaveBeenCalledWith(START, {})
  expect(statusReads()).toBe(2)
  expect(screen.queryByRole('button', { name: '배포 시작' })).toBeNull()
  expect(stage('빌드')).toBe('빌드진행 중')
  await advance(3000)
  expect(statusReads()).toBe(3)
})

it('locks the start button while the request is out', async () => {
  api.apiFetch.mockImplementation((path: string) =>
    path === START ? new Promise(() => undefined) : Promise.resolve(progressOf('not_started', 'secrets')),
  )
  await show()
  await clickStart()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '시작하는 중…' }).disabled).toBe(true)
})

it.each([
  [new ApiError(409, 'NOT_READY', 'x'), '아직 시작할 수 없어요'],
  [new ApiError(409, 'DEPLOY_IN_PROGRESS', 'x'), '같은 프로젝트의 배포가 진행 중이에요'],
  [new ApiError(409, 'CLUSTER_FULL', 'x'), '지금 클러스터에 자리가 없어요'],
  [new ApiError(503, 'PIPELINE_UNAVAILABLE', 'x'), '지금은 배포를 시작할 수 없어요'],
  [new ApiError(0, 'NETWORK_ERROR', 'x'), '지금은 배포를 시작할 수 없어요'],
  [new ApiError(500, 'INTERNAL', 'x'), '배포를 시작하지 못했어요'],
])('explains a failed start (%s) and lets the user try again', async (error, title) => {
  api.apiFetch.mockImplementation((path: string) =>
    path === START ? Promise.reject(error) : Promise.resolve(progressOf('not_started', 'secrets')),
  )
  await show()
  await clickStart()
  expect(screen.getByText(title)).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '배포 시작' }).disabled).toBe(false)
  expect(statusReads()).toBe(2)
})

it('does not call an already started deploy an error, it just shows what the server now says', async () => {
  api.apiFetch.mockImplementation((path: string) => {
    if (path === START) return Promise.reject(new ApiError(409, 'ALREADY_STARTED', 'x'))
    return Promise.resolve(statusReads() <= 1 ? progressOf('not_started', 'secrets') : progressOf('running', 'build'))
  })
  await show()
  await clickStart()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(stage('빌드')).toBe('빌드진행 중')
})

it('lists the missing secret names the server named on NOT_READY, and falls back to the plain text without them', async () => {
  api.apiFetch.mockImplementation((path: string) =>
    path === START
      ? Promise.reject(
          new ApiError(409, 'NOT_READY', 'x', [
            { path: 'secrets.be.DATABASE_URL', code: 'REQUIRED' },
            { path: 'secrets.ai.OPENAI_API_KEY', code: 'REQUIRED' },
            { path: 'secrets.be', code: 'REQUIRED' },
            { path: 'services.be.JWT_SECRET', code: 'REQUIRED' },
            { path: 'secrets.be.A.B', code: 'REQUIRED' },
          ]),
        )
      : Promise.resolve(progressOf('not_started', 'secrets')),
  )
  await show()
  await clickStart()
  const list = within(screen.getByRole('list', { name: '' }))
  expect(list.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['be · DATABASE_URL', 'ai · OPENAI_API_KEY', 'secrets.be', 'services.be.JWT_SECRET', 'secrets.be.A.B'])
})

it('says only the plain text when NOT_READY names nothing', async () => {
  api.apiFetch.mockImplementation((path: string) =>
    path === START ? Promise.reject(new ApiError(409, 'NOT_READY', 'x')) : Promise.resolve(progressOf('not_started', 'secrets')),
  )
  await show()
  await clickStart()
  expect(screen.getByText('아직 시작할 수 없어요')).toBeTruthy()
  expect(screen.queryByText('빠진 항목')).toBeNull()
})

const secretsLink = () => screen.queryByRole('link', { name: '비밀값 넣으러 가기' })

it('links to the secrets screen before the start button while the deploy is not started', async () => {
  api.apiFetch.mockResolvedValue(progressOf('not_started', 'secrets'))
  await show()
  expect(secretsLink()?.getAttribute('href')).toBe(`/deploys/${ID}/secrets`)
})

it('keeps the secrets link, next to the missing names, after NOT_READY', async () => {
  api.apiFetch.mockImplementation((path: string) =>
    path === START
      ? Promise.reject(new ApiError(409, 'NOT_READY', 'x', [{ path: 'secrets.be.DATABASE_URL', code: 'REQUIRED' }]))
      : Promise.resolve(progressOf('not_started', 'secrets')),
  )
  await show()
  await clickStart()
  expect(screen.getByText('be · DATABASE_URL')).toBeTruthy()
  expect(secretsLink()?.getAttribute('href')).toBe(`/deploys/${ID}/secrets`)
})

it.each([
  ['queued', 'build'],
  ['running', 'build'],
  ['fixing', 'build'],
  ['succeeded', null],
  ['failed', 'build'],
] as const)('hides the secrets link when the status is %s', async (status, at) => {
  api.apiFetch.mockResolvedValue(progressOf(status, at, status === 'failed' ? { failure: failureWith('BUILD_FAILED') } : {}))
  await show()
  expect(secretsLink()).toBeNull()
})

it('shows security warnings without blocking the result', async () => {
  api.apiFetch.mockResolvedValue(
    progressOf('succeeded', null, {
      url: 'https://my-app.stairnoworks.com',
      warnings: [{ code: 'SECRET_IN_REPO', message: '비밀값처럼 보이는 문자열이 있어요', service: 'be' }],
    }),
  )
  await show()
  const alert = within(screen.getByText('보안 검사 경고가 있어요').closest('[role="status"]') as HTMLElement)
  expect(alert.getByText(/비밀값처럼 보이는 문자열이 있어요 \(서비스: be\)/)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'https://my-app.stairnoworks.com' })).toBeTruthy()
})

it('shows no warning box when there are none', async () => {
  api.apiFetch.mockResolvedValue(progressOf('succeeded', null, { url: 'https://my-app.stairnoworks.com' }))
  await show()
  expect(screen.queryByText('보안 검사 경고가 있어요')).toBeNull()
})

it('shows no error for an already started deploy even when the next read still says not started', async () => {
  api.apiFetch.mockImplementation((path: string) =>
    path === START ? Promise.reject(new ApiError(409, 'ALREADY_STARTED', 'x')) : Promise.resolve(progressOf('not_started', 'secrets')),
  )
  await show()
  await clickStart()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(statusReads()).toBe(2)
})

it('drops the old start failure as soon as the user tries again', async () => {
  let starts = 0
  api.apiFetch.mockImplementation((path: string) => {
    if (path !== START) return Promise.resolve(progressOf('not_started', 'secrets'))
    starts += 1
    return starts === 1 ? Promise.reject(new ApiError(409, 'NOT_READY', 'x')) : new Promise(() => undefined)
  })
  await show()
  await clickStart()
  expect(screen.getByText('아직 시작할 수 없어요')).toBeTruthy()
  await clickStart()
  expect(screen.queryByText('아직 시작할 수 없어요')).toBeNull()
})

it('shows the failure the server gave, with the stage and service', async () => {
  api.apiFetch.mockResolvedValue(progressOf('failed', 'build', { failure: failureWith('BUILD_FAILED', '빌드에 실패했어요') }))
  await show()
  const alert = within(screen.getByRole('alert'))
  expect(alert.getByText('배포하지 못했어요')).toBeTruthy()
  expect(alert.getByText('빌드에 실패했어요')).toBeTruthy()
  expect(alert.getByText(/단계: 빌드 · 서비스: be/)).toBeTruthy()
  expect(stage('빌드')).toBe('빌드실패')
  expect(alert.queryByText(/학생 잘못이 아니에요/)).toBeNull()
})

it('names the stage by the step that failed, not by the pipeline stage word', async () => {
  api.apiFetch.mockResolvedValue(
    progressOf('failed', 'deploy', { failure: { code: 'DEPLOY_FAILED', stage: 'apply', service: null, message: '배포에 실패했어요' } }),
  )
  await show()
  expect(screen.getByText(/단계: 배포$/)).toBeTruthy()
  expect(screen.queryByText(/apply/)).toBeNull()
})

it('falls back to the stage word the server gave when no step is marked failed', async () => {
  api.apiFetch.mockResolvedValue(
    progressOf('failed', 'deploy', {
      steps: stepsAt('deploy'),
      failure: { code: 'SWITCH_FAILED', stage: 'switch', service: null, message: '주소를 바꾸지 못했어요' },
    }),
  )
  await show()
  expect(screen.getByText(/단계: switch$/)).toBeTruthy()
})

it('says it is not the student fault when the platform is to blame', async () => {
  api.apiFetch.mockResolvedValue(progressOf('failed', 'build', { failure: failureWith('CODEBUILD_API_ERROR', '빌드 서비스에 닿지 못했어요') }))
  await show()
  expect(screen.getByText(/학생 잘못이 아니에요/)).toBeTruthy()
})

it('does not say it is not the student fault for a failure the student can fix', async () => {
  api.apiFetch.mockResolvedValue(progressOf('failed', 'build', { failure: failureWith('BUILD_FAILED', '빌드에 실패했어요') }))
  await show()
  expect(screen.getByText('빌드에 실패했어요')).toBeTruthy()
  expect(screen.queryByText(/학생 잘못이 아니에요/)).toBeNull()
})

it('asks the user to act when the server says so', async () => {
  api.apiFetch.mockResolvedValue(progressOf('needs_user', 'deploy', { failure: failureWith('DEPLOY_FAILED', '환경변수를 확인해 주세요') }))
  await show()
  expect(screen.getByText('사용자 조치가 필요해요')).toBeTruthy()
  expect(screen.getByText('환경변수를 확인해 주세요')).toBeTruthy()
  expect(stage('배포')).toBe('배포입력 대기사용자 조치 필요')
})

it('shows the public address as a link and copies it', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  api.apiFetch.mockResolvedValue(progressOf('succeeded', null, { url: 'https://my-app.stairnoworks.com' }))
  await show()
  const link = screen.getByRole('link', { name: 'https://my-app.stairnoworks.com' })
  expect(link.getAttribute('href')).toBe('https://my-app.stairnoworks.com')
  expect(link.getAttribute('rel')).toContain('noopener')
  expect(screen.getAllByRole('listitem').every((li) => li.lastElementChild?.textContent?.endsWith('(완료)'))).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '주소 복사' }))
  await advance(0)
  expect(writeText).toHaveBeenCalledWith('https://my-app.stairnoworks.com')
  expect(screen.getByText('복사했어요')).toBeTruthy()
})

it('says so when copying is not possible', async () => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  api.apiFetch.mockResolvedValue(progressOf('succeeded', null, { url: 'https://my-app.stairnoworks.com' }))
  await show()
  fireEvent.click(screen.getByRole('button', { name: '주소 복사' }))
  await advance(0)
  expect(screen.getByText(/복사하지 못했어요/)).toBeTruthy()
})

it('does not turn an address that is not https into a link', async () => {
  api.apiFetch.mockResolvedValue(progressOf('succeeded', null, { url: 'javascript:alert(1)' }))
  await show()
  expect(screen.queryByRole('link', { name: /javascript/ })).toBeNull()
})

it('shows the service status card only for a succeeded deploy', async () => {
  api.apiFetch.mockResolvedValue(progressOf('running', 'build'))
  const { unmount } = await show()
  expect(screen.queryByText(/서비스 상태 카드/)).toBeNull()
  unmount()

  api.apiFetch.mockResolvedValue(progressOf('succeeded', null, { url: 'https://my-app.example.com' }))
  await show()
  expect(screen.getByText(`서비스 상태 카드 ${ID}`)).toBeTruthy()
})

it('shows the operations alerts of this deploy in every status, and not while the status is still loading', async () => {
  api.apiFetch.mockReturnValue(new Promise(() => undefined))
  const loading = render(
    <MemoryRouter>
      <DeployProgress deployId={ID} />
    </MemoryRouter>,
  )
  expect(screen.queryByText(/운영 알림/)).toBeNull()
  loading.unmount()

  for (const status of ['running', 'succeeded', 'failed'] as const) {
    api.apiFetch.mockResolvedValue(progressOf(status, status === 'running' ? 'build' : null))
    const { unmount } = await show()
    expect(screen.getByText(`운영 알림 ${ID}`)).toBeTruthy()
    unmount()
  }
})

const agentOf = (extra: Partial<NonNullable<Progress['agent']>> = {}): NonNullable<Progress['agent']> => ({
  status: 'gave_up',
  summary: 'AI 모델 설정이 없어 문제 해결을 하지 않았습니다.',
  userRequest: null,
  prUrl: null,
  evidence: [],
  ...extra,
})
const agentCard = () => within(screen.getByRole('region', { name: 'AI 동료' }))
const gaveUp: Partial<Progress> = {
  failure: { code: 'AGENT_GAVE_UP', stage: 'apply', service: 'web', message: 'AI 에이전트가 이 실패를 해결하지 못했습니다.' },
  agent: agentOf(),
}

it('shows the AI colleague result and no platform-fault note when the agent gave up', async () => {
  api.apiFetch.mockResolvedValue(progressOf('failed', 'deploy', gaveUp))
  await show()
  expect(agentCard().getByText('해결하지 못했어요')).toBeTruthy()
  expect(agentCard().getByText('AI 모델 설정이 없어 문제 해결을 하지 않았습니다.')).toBeTruthy()
  expect(screen.queryByText(/플랫폼 쪽 문제예요/)).toBeNull()
})

it('still says it is the platform when the AI server was unavailable', async () => {
  api.apiFetch.mockResolvedValue(progressOf('failed', 'deploy', { failure: failureWith('AGENT_UNAVAILABLE') }))
  await show()
  expect(screen.getByText(/플랫폼 쪽 문제예요/)).toBeTruthy()
  expect(screen.queryByRole('region', { name: 'AI 동료' })).toBeNull()
})

it('says the agent fixed it and redeployed when verified', async () => {
  api.apiFetch.mockResolvedValue(
    progressOf('succeeded', null, { url: 'https://a.stairnoworks.com', agent: agentOf({ status: 'verified', summary: '포트를 3000으로 고쳤어요.' }) }),
  )
  await show()
  expect(agentCard().getByText('고쳐서 다시 배포했어요')).toBeTruthy()
  expect(agentCard().getByText('포트를 3000으로 고쳤어요.')).toBeTruthy()
})

it('links to the fix PR when the agent opened one, and only for an https address', async () => {
  api.apiFetch.mockResolvedValue(
    progressOf('failed', 'deploy', { agent: agentOf({ status: 'pr_opened', prUrl: 'https://github.com/o/r/pull/3' }) }),
  )
  await show()
  expect(agentCard().getByText('수정 PR을 열었어요')).toBeTruthy()
  expect(agentCard().getByRole('link', { name: '수정 PR 보러 가기' }).getAttribute('href')).toBe('https://github.com/o/r/pull/3')
})

it('tells the student what to do with a fix PR and offers 다시 배포 that carries this deploy id; the badge names the PR', async () => {
  api.apiFetch.mockResolvedValue(
    progressOf('needs_user', 'deploy', { agent: agentOf({ status: 'pr_opened', prUrl: 'https://github.com/o/r/pull/3' }) }),
  )
  await show()
  expect(screen.getByText('수정 PR 확인 필요')).toBeTruthy()
  expect(agentCard().getByText('GitHub에서 PR을 머지해요.')).toBeTruthy()
  expect(agentCard().getByRole('link', { name: '다시 배포' }).getAttribute('href')).toBe(`/deploy/new?from=${ID}`)
})

it('keeps the generic label and no 다시 배포 for a needs_user run without a PR', async () => {
  api.apiFetch.mockResolvedValue(progressOf('needs_user', 'deploy', { agent: agentOf({ status: 'needs_user' }) }))
  await show()
  expect(screen.getAllByText('사용자 조치 필요').length).toBeGreaterThan(0)
  expect(screen.queryByText('수정 PR 확인 필요')).toBeNull()
  expect(screen.queryByRole('link', { name: '다시 배포' })).toBeNull()
})

it('shows no next steps for a result that is not a PR waiting for the student', async () => {
  api.apiFetch.mockResolvedValue(progressOf('failed', 'deploy', { agent: agentOf({ status: 'gave_up', prUrl: 'https://github.com/o/r/pull/3' }) }))
  await show()
  expect(screen.queryByRole('link', { name: '다시 배포' })).toBeNull()
})

it('does not link a PR address that is not https', async () => {
  api.apiFetch.mockResolvedValue(progressOf('failed', 'deploy', { agent: agentOf({ status: 'pr_opened', prUrl: 'javascript:alert(1)' }) }))
  await show()
  expect(agentCard().queryByRole('link')).toBeNull()
})

it('tells the student what to do and lists the secret keys and points to a new deploy, not the secrets page, when the agent needs the user', async () => {
  api.apiFetch.mockResolvedValue(
    progressOf('needs_user', 'secrets', {
      failure: { code: 'NEEDS_USER', stage: 'apply', service: 'web', message: '확인이 필요해요' },
      agent: agentOf({ status: 'needs_user', userRequest: { message: 'API 키를 다시 넣어 주세요.', secretKeys: ['OPENAI_KEY', 'DB_URL'] } }),
    }),
  )
  await show()
  expect(agentCard().getByText('내가 할 일이 있어요')).toBeTruthy()
  expect(agentCard().getByText('API 키를 다시 넣어 주세요.')).toBeTruthy()
  expect(agentCard().getByText('OPENAI_KEY')).toBeTruthy()
  expect(agentCard().getByText('DB_URL')).toBeTruthy()
  expect(agentCard().getByText(/새 배포를 요청해 주세요/)).toBeTruthy()
  expect(agentCard().getByRole('link', { name: '새 배포 요청하기' }).getAttribute('href')).toBe('/deploy/new')
  // 이미 시작한 배포라 비밀값 페이지로 가도 이어 갈 수 없다.
  expect(agentCard().queryByRole('link', { name: '비밀값 넣으러 가기' })).toBeNull()
})

it('lists the evidence only when there is some, skipping empty entries', async () => {
  api.apiFetch.mockResolvedValue(
    progressOf('failed', 'deploy', { agent: agentOf({ evidence: [{ ref: 'Dockerfile:3', text: 'EXPOSE가 없어요' }, { ref: null, text: null }] }) }),
  )
  await show()
  expect(agentCard().getByText('근거')).toBeTruthy()
  expect(agentCard().getAllByRole('listitem')).toHaveLength(1)
  expect(agentCard().getByText('Dockerfile:3')).toBeTruthy()
})

it('draws no AI colleague section when the agent is null or missing', async () => {
  api.apiFetch.mockResolvedValue(progressOf('failed', 'deploy', { failure: failureWith('BUILD_FAILED'), agent: null }))
  await show()
  expect(screen.queryByRole('region', { name: 'AI 동료' })).toBeNull()
})

it('says the security scan found nothing when a succeeded deploy has no warnings', async () => {
  api.apiFetch.mockResolvedValue(progressOf('succeeded', null, { url: 'https://a.stairnoworks.com' }))
  await show()
  expect(screen.getByText('보안 검사: 찾은 문제가 없어요')).toBeTruthy()
})

it('does not say the scan found nothing when there are warnings, or when the deploy has not succeeded', async () => {
  api.apiFetch.mockResolvedValue(
    progressOf('succeeded', null, { url: 'https://a.stairnoworks.com', warnings: [{ code: 'SCAN_RUNNING', message: '검사 중이에요', service: null }] }),
  )
  const { unmount } = await show()
  expect(screen.queryByText(/찾은 문제가 없어요/)).toBeNull()
  unmount()
  api.apiFetch.mockResolvedValue(progressOf('failed', 'deploy', { failure: failureWith('BUILD_FAILED') }))
  await show()
  expect(screen.queryByText(/찾은 문제가 없어요/)).toBeNull()
})

it('shows the project name, repo and short commit from the saved deploy, and the service map with the overall status', async () => {
  reads.saved = { id: ID, repo: 'me/shop', commit: '0123456789abcdef', createdAt: '', spec: { project: { slug: 'shop', repo: 'me/shop' }, services: [] } }
  api.apiFetch.mockResolvedValue(progressOf('running', 'build'))
  await show()
  expect(screen.getByText('shop')).toBeTruthy()
  expect(screen.getByText(/me\/shop · 0123456/)).toBeTruthy()
  expect(screen.getByText('서비스 구성도 running')).toBeTruthy()
})

it('draws neither the header nor the map when the saved deploy could not be read', async () => {
  api.apiFetch.mockResolvedValue(progressOf('running', 'build'))
  await show()
  expect(screen.queryByText(/서비스 구성도/)).toBeNull()
})

it('says the deploy is done but waiting for the health check while a service is still starting, and healthy once all run', async () => {
  const live = (state: string) => ({ state: 'live', services: [{ name: 'fe', state }] })
  api.apiFetch.mockResolvedValue(progressOf('succeeded', null, { url: 'https://my-app.example.com' }))
  reads.metrics = live('starting')
  const { unmount } = await show()
  expect(screen.getByText('배포 완료 · 헬스 체크 대기 중')).toBeTruthy()
  unmount()
  reads.metrics = live('running')
  await show()
  expect(screen.getByText('실행 중(정상)')).toBeTruthy()
})

it('shows only the reading interval, with no spinner, next to the status while running', async () => {
  api.apiFetch.mockResolvedValue(progressOf('running', 'build'))
  const { container } = await show()
  expect(screen.getByText('3초마다 새로 읽고 있어요')).toBeTruthy()
  expect(container.querySelector('.spinner')).toBeNull()
})
