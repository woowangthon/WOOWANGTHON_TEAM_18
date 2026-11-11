import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AdminNode, AdminProject, NodesResponse, ProjectsResponse } from '../admin/types.ts'
import { REFRESH_MS } from '../admin/useAdminRead.ts'
import { ApiError } from '../lib/api.ts'
import AdminPage from './AdminPage.tsx'

// 실제 BE를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  apiFetch: api.apiFetch,
}))

const NODES = '/api/admin/nodes'
const PROJECTS = '/api/admin/projects'
const stopPath = (slug: string) => `/api/admin/projects/${slug}/stop`

const leader: AdminNode = {
  name: 'leader',
  ready: true,
  role: 'leader',
  cpu: { capacityMillicores: 4000, allocatableMillicores: 3900 },
  memory: { capacityBytes: 16 * 1024 ** 3, allocatableBytes: 15 * 1024 ** 3 },
  disk: { capacityBytes: 250 * 1024 ** 3, allocatableBytes: 230 * 1024 ** 3 },
  usage: null,
}
const worker: AdminNode = {
  name: 'worker-1',
  ready: false,
  role: 'worker',
  cpu: { capacityMillicores: 2000, allocatableMillicores: null },
  memory: { capacityBytes: null, allocatableBytes: null },
  disk: { capacityBytes: 100 * 1024 ** 3, allocatableBytes: 90 * 1024 ** 3 },
  usage: null,
}
const nodesOf = (nodes: AdminNode[] = [leader, worker], usageStatus = 'not_collected'): NodesResponse => ({ usageStatus, nodes })

const running: AdminProject = {
  slug: 'my-app',
  repo: 'student/my-app',
  ownerId: '11111111-1111-4111-8111-111111111111',
  liveSlot: 'a',
  url: 'https://my-app.stairnoworks.com',
  lastStop: null,
  services: [
    {
      name: 'fe-a',
      slot: 'a',
      replicas: 1,
      readyReplicas: 0,
      pods: [{ name: 'fe-a-6d9f-xk2', phase: 'Pending', ready: false, node: 'worker-1', restarts: 2 }],
    },
    { name: 'be-a', slot: 'a', replicas: 1, readyReplicas: 1, pods: [] },
  ],
}
const stopped: AdminProject = {
  ...running,
  slug: 'old-app',
  url: null,
  liveSlot: null,
  lastStop: { at: '2026-11-11T01:00:00.000Z', by: 'operator' },
  services: [{ name: 'fe-a', slot: 'a', replicas: 0, readyReplicas: 0, pods: [] }],
}
const noSpace: AdminProject = { ...running, slug: 'new-app', url: null, liveSlot: null, services: [] }
const projectsOf = (projects: AdminProject[] = [running, stopped, noSpace]): ProjectsResponse => ({ projects })

// 경로마다 답을 정한다. 값이 함수면 부를 때마다 새로 만든다.
type Reply = unknown
let replies: Record<string, Reply>
const serve = (next: Record<string, Reply>) => {
  replies = { [NODES]: nodesOf(), [PROJECTS]: projectsOf(), ...next }
}
beforeEach(() => {
  vi.useFakeTimers()
  api.apiFetch.mockReset().mockImplementation((path: string) => {
    const reply = replies[path]
    return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)
  })
  serve({})
})
afterEach(() => {
  vi.useRealTimers()
})

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
const reads = (path: string) => api.apiFetch.mock.calls.filter((c) => c[0] === path).length
const show = async () => {
  const view = render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>,
  )
  await advance(0)
  return view
}
const card = (name: string) => screen.getByText(name, { selector: 'span' }).closest('li') as HTMLElement
const press = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }))
  await advance(0)
}

it('lists every node with its role, readiness and capacity as the server gave them', async () => {
  await show()
  const node = within(card('leader'))
  expect(node.getByText('리더')).toBeTruthy()
  expect(node.getByText('Ready')).toBeTruthy()
  expect(node.getByText('4코어 (할당 가능 3.9코어)')).toBeTruthy()
  expect(node.getByText('16.0 GiB (할당 가능 15.0 GiB)')).toBeTruthy()
  expect(node.getByText('250.0 GiB (할당 가능 230.0 GiB)')).toBeTruthy()
  expect(within(card('worker-1')).getByText('워커')).toBeTruthy()
  expect(within(card('worker-1')).getByText('NotReady')).toBeTruthy()
})

it('says "수집 전" for usage, and says unreadable for a field the server gave as null', async () => {
  await show()
  expect(within(card('leader')).getByText('수집 전')).toBeTruthy()
  expect(within(card('worker-1')).getByText('수집 전')).toBeTruthy()
  expect(within(card('worker-1')).getByText('2코어 (할당 가능 읽지 못함)')).toBeTruthy()
  expect(within(card('worker-1')).getByText('읽지 못함 (할당 가능 읽지 못함)')).toBeTruthy()
})

it('shows the usage numbers once the server collects them', async () => {
  serve({ [NODES]: nodesOf([{ ...leader, usage: { cpuMillicores: 500, memoryBytes: 2 * 1024 ** 3 } }], 'collected') })
  await show()
  expect(within(card('leader')).getByText('CPU 0.5코어 · 메모리 2.0 GiB')).toBeTruthy()
  expect(screen.queryByText('수집 전')).toBeNull()
})

it('rounds a CPU figure to one decimal place for reading', async () => {
  serve({ [NODES]: nodesOf([{ ...leader, cpu: { capacityMillicores: 3333, allocatableMillicores: 3333 } }]) })
  await show()
  expect(within(card('leader')).getByText('3.3코어 (할당 가능 3.3코어)')).toBeTruthy()
})

it('shows "수집 전" while the server says usage is not collected, even if a usage object came along', async () => {
  serve({ [NODES]: nodesOf([{ ...leader, usage: { cpuMillicores: 500, memoryBytes: 1 } }], 'not_collected') })
  await show()
  expect(within(card('leader')).getByText('수집 전')).toBeTruthy()
})

it('says no node is visible instead of an empty list', async () => {
  serve({ [NODES]: nodesOf([]) })
  await show()
  expect(screen.getByText('보이는 노드가 없어요.')).toBeTruthy()
})

it('shows each project with its services, pods, owner and an https address as a link', async () => {
  await show()
  const project = within(card('my-app'))
  expect(project.getByText('실행 중')).toBeTruthy()
  expect(project.getByText('라이브 슬롯 a')).toBeTruthy()
  expect(project.getByText('student/my-app')).toBeTruthy()
  expect(project.getByText('11111111-1111-4111-8111-111111111111')).toBeTruthy()
  expect(project.getByRole('link', { name: 'https://my-app.stairnoworks.com' }).getAttribute('href')).toBe('https://my-app.stairnoworks.com')
  expect(project.getByText(/준비 0\/1/)).toBeTruthy()
  expect(project.getByText(/Pending · 준비 안 됨 · 노드 worker-1 · 재시작 2회/)).toBeTruthy()
})

it('does not turn an address that is not https into a link', async () => {
  serve({ [PROJECTS]: projectsOf([{ ...running, url: 'http://my-app.stairnoworks.com' }]) })
  await show()
  expect(screen.queryByRole('link', { name: /stairnoworks/ })).toBeNull()
  expect(within(card('my-app')).getByText('아직 없음')).toBeTruthy()
})

it('tells a stopped project from one with no namespace by the replicas, and offers no stop for either', async () => {
  await show()
  expect(within(card('old-app')).getByText('중지됨')).toBeTruthy()
  expect(within(card('old-app')).getByText(/operator/)).toBeTruthy()
  expect(within(card('new-app')).getByText('공간 없음')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'old-app 강제 중지' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'new-app 강제 중지' })).toBeNull()
  expect(screen.getByRole('button', { name: 'my-app 강제 중지' })).toBeTruthy()
})

it('treats a project as running while any of its services still has replicas, and offers the stop', async () => {
  const partial: AdminProject = {
    ...running,
    services: [
      { name: 'fe-a', slot: 'a', replicas: 0, readyReplicas: 0, pods: [] },
      { name: 'be-a', slot: 'a', replicas: 2, readyReplicas: 2, pods: [] },
    ],
  }
  serve({ [PROJECTS]: projectsOf([partial]) })
  await show()
  expect(within(card('my-app')).getByText('실행 중')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'my-app 강제 중지' })).toBeTruthy()
})

it('says there are no saved deploys instead of an empty list', async () => {
  serve({ [PROJECTS]: projectsOf([]) })
  await show()
  expect(screen.getByText('저장된 배포가 없어요.')).toBeTruthy()
})

it('reads again every refresh interval, on demand, and stops when the user leaves', async () => {
  const { unmount } = await show()
  expect(reads(NODES)).toBe(1)
  expect(reads(PROJECTS)).toBe(1)
  await advance(REFRESH_MS)
  expect(reads(NODES)).toBe(2)
  expect(reads(PROJECTS)).toBe(2)
  await press('지금 새로 읽기')
  expect(reads(NODES)).toBe(3)
  expect(reads(PROJECTS)).toBe(3)
  unmount()
  await advance(REFRESH_MS * 3)
  expect(reads(NODES)).toBe(3)
  expect(reads(PROJECTS)).toBe(3)
})

it.each([
  [new ApiError(503, 'CLUSTER_UNREACHABLE', 'x'), '리더 무응답'],
  [new ApiError(503, 'CLUSTER_FORBIDDEN', 'x'), '리더에는 닿았지만 서버 계정에 권한이 없어요'],
  [new ApiError(503, 'DATABASE_UNAVAILABLE', 'x'), '서버와 연결하지 못했어요'],
  [new ApiError(0, 'NETWORK_ERROR', 'x'), '서버와 연결하지 못했어요'],
  [new ApiError(500, 'INTERNAL', 'x'), '노드 현황을 읽지 못했어요'],
])('names the problem (%s) and keeps the last nodes on screen', async (error, title) => {
  await show()
  replies[NODES] = error
  await advance(REFRESH_MS)
  expect(screen.getByText(title, { selector: 'p' })).toBeTruthy()
  expect(screen.getByText(/아래는 마지막으로 읽은 값이에요/)).toBeTruthy()
  expect(screen.getByText('leader', { selector: 'span' })).toBeTruthy()
})

it('shows the problem instead of a spinner when the first read fails, without touching the other section', async () => {
  serve({ [NODES]: new ApiError(503, 'CLUSTER_UNREACHABLE', 'x') })
  await show()
  expect(screen.getByText('리더 무응답')).toBeTruthy()
  expect(screen.queryByText('노드 현황을 불러오는 중…')).toBeNull()
  expect(card('my-app')).toBeTruthy()
})

it('shows the forbidden notice and stops reading when the server says the user is not an operator', async () => {
  serve({ [NODES]: new ApiError(403, 'ADMIN_REQUIRED', 'x') })
  await show()
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('권한이 없어요')
  expect(screen.queryByText('노드 현황')).toBeNull()
  const before = reads(NODES)
  await advance(REFRESH_MS * 3)
  expect(reads(NODES)).toBe(before)
})

it('shows the forbidden notice when only the projects read is refused', async () => {
  serve({ [PROJECTS]: new ApiError(403, 'ADMIN_REQUIRED', 'x') })
  await show()
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('권한이 없어요')
})

it('asks before stopping, sends nothing when cancelled, and then does not show the stop result', async () => {
  await show()
  await press('my-app 강제 중지')
  expect(screen.getByText('my-app를 강제로 중지할까요?')).toBeTruthy()
  await press('취소')
  expect(reads(stopPath('my-app'))).toBe(0)
  expect(screen.queryByText('my-app를 강제로 중지할까요?')).toBeNull()
})

it('stops the project after the confirmation, shows what was scaled down and reads the projects again', async () => {
  serve({ [stopPath('my-app')]: { slug: 'my-app', scaled: ['fe-a', 'be-a'], failed: [] } })
  await show()
  await press('my-app 강제 중지')
  await press('my-app 중지하기')
  expect(api.apiFetch).toHaveBeenCalledWith(stopPath('my-app'), {})
  expect(screen.getByText('중지했어요')).toBeTruthy()
  expect(screen.getByText('내린 서비스: fe-a, be-a')).toBeTruthy()
  expect(reads(PROJECTS)).toBe(2)
})

it('keeps showing what the stop did after the reload shows the project as stopped', async () => {
  serve({ [stopPath('my-app')]: { slug: 'my-app', scaled: ['fe-a', 'be-a'], failed: [] } })
  await show()
  replies[PROJECTS] = projectsOf([{ ...running, services: running.services.map((s) => ({ ...s, replicas: 0, readyReplicas: 0 })) }])
  await press('my-app 강제 중지')
  await press('my-app 중지하기')
  const project = within(card('my-app'))
  expect(project.getByText('중지됨')).toBeTruthy()
  expect(project.getByText('중지했어요')).toBeTruthy()
  expect(project.getByText('내린 서비스: fe-a, be-a')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'my-app 강제 중지' })).toBeNull()
})

it('says which services stayed up when only some were scaled down', async () => {
  serve({ [stopPath('my-app')]: { slug: 'my-app', scaled: ['fe-a'], failed: ['be-a'] } })
  await show()
  await press('my-app 강제 중지')
  await press('my-app 중지하기')
  expect(screen.getByText('일부만 중지했어요')).toBeTruthy()
  expect(screen.getByText(/내리지 못한 서비스: be-a/)).toBeTruthy()
})

it('sends the stop once even if the button is pressed again while it is going', async () => {
  let finish: (value: unknown) => void = () => undefined
  api.apiFetch.mockImplementation((path: string) =>
    path === stopPath('my-app')
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve(replies[path]),
  )
  await show()
  await press('my-app 강제 중지')
  await press('my-app 중지하기')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'my-app 중지하기' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'my-app 중지하기' }))
  await advance(0)
  expect(reads(stopPath('my-app'))).toBe(1)
  finish({ slug: 'my-app', scaled: ['fe-a'], failed: [] })
  await advance(0)
  expect(screen.getByText('중지했어요')).toBeTruthy()
})

it.each([
  [new ApiError(409, 'NOT_RUNNING', 'x'), '이미 꺼져 있어요'],
  [new ApiError(404, 'PROJECT_NOT_FOUND', 'x'), '프로젝트를 찾을 수 없어요'],
  [new ApiError(503, 'CLUSTER_FORBIDDEN', 'x'), '리더에는 닿았지만 서버 계정에 권한이 없어요'],
  [new ApiError(503, 'CLUSTER_UNREACHABLE', 'x'), '리더 무응답'],
  [new ApiError(500, 'INTERNAL', 'x'), '중지하지 못했어요'],
])('explains a failed stop (%s) and reads the projects again', async (error, title) => {
  serve({ [stopPath('my-app')]: error })
  await show()
  await press('my-app 강제 중지')
  await press('my-app 중지하기')
  expect(within(card('my-app')).getByText(title)).toBeTruthy()
  expect(within(card('my-app')).queryByText('중지했어요')).toBeNull()
  expect(reads(PROJECTS)).toBe(2)
})
