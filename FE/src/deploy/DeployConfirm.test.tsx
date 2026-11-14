import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api.ts'
import DeployConfirm from './DeployConfirm.tsx'
import { beProject, COMMIT, draftOf, feProject } from './fixtures.ts'
import type { DraftProject, SavedDeploy } from './types.ts'

// 실제 BE를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  apiFetch: api.apiFetch,
}))

const REPO_URL = 'https://github.com/student/my-app'
const onRecheck = vi.fn()

beforeEach(() => {
  api.apiFetch.mockReset()
  onRecheck.mockReset()
})

type Overrides = { commit?: string | null; dockerfiles?: string[] }
const renderConfirm = ({ commit = COMMIT, dockerfiles = [] }: Overrides = {}) =>
  render(
    <MemoryRouter>
      <DeployConfirm repoUrl={REPO_URL} repo="student/my-app" commit={commit} dockerfiles={dockerfiles} onRecheck={onRecheck} />
    </MemoryRouter>,
  )

// deploy-spec에는 초안으로, deploys에는 saveWith로 답한다.
const respond = (projects: DraftProject[], saveWith?: (body: unknown) => unknown, truncated = false) =>
  api.apiFetch.mockImplementation((path: string, body: unknown) => {
    if (path === '/api/repos/deploy-spec') return Promise.resolve(draftOf(projects, truncated))
    return saveWith ? Promise.resolve(saveWith(body)) : Promise.reject(new ApiError(500, 'X', 'x'))
  })
const rejectSave = (error: ApiError) =>
  api.apiFetch.mockImplementation((path: string) =>
    path === '/api/repos/deploy-spec' ? Promise.resolve(draftOf([feProject])) : Promise.reject(error),
  )
const saved = (body: unknown): SavedDeploy => {
  const { commit, spec } = body as { commit: string; spec: SavedDeploy['spec'] }
  return { id: 'dep-1', repo: 'student/my-app', commit, spec, createdAt: '2026-11-10T01:00:00.000Z' }
}
const calls = (path: string) => api.apiFetch.mock.calls.filter((c) => c[0] === path)
const service = (n: number) => within(screen.getByRole('region', { name: `서비스 ${n}` }))
const confirmButton = () => screen.getByRole('button', { name: '배포 설정 확정' })
const ready = () => screen.findByRole('region', { name: '서비스 1' })

it('asks for the draft once with the commit from the check, unchanged, and fills the form', async () => {
  respond([feProject, beProject])
  renderConfirm({ dockerfiles: ['BE/Dockerfile'] })
  await ready()
  expect(calls('/api/repos/deploy-spec')).toEqual([['/api/repos/deploy-spec', { repoUrl: REPO_URL, commit: COMMIT }]])
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: /프로젝트 이름/ }).value).toBe('my-app')
  expect(screen.getByText('student/my-app')).toBeTruthy()
  expect(service(1).getByRole<HTMLInputElement>('textbox', { name: '이름' }).value).toBe('fe')
  expect(service(1).getByRole<HTMLSelectElement>('combobox', { name: '역할' }).value).toBe('fe')
  expect(service(2).getByRole<HTMLSelectElement>('combobox', { name: 'Dockerfile' }).value).toBe('BE/Dockerfile')
  expect(service(2).getByRole<HTMLSelectElement>('combobox', { name: '역할' }).value).toBe('')
})

it('shows the source of a detected value and asks the user to choose when it could not decide', async () => {
  respond([{ ...beProject, dockerfile: false, nodeVersion: '>=22' }])
  renderConfirm()
  await ready()
  expect(service(1).getAllByText('출처: 락 파일').length).toBeGreaterThan(0)
  expect(service(1).getAllByText(/자동으로 정하지 못했어요. 골라 주세요/).length).toBeGreaterThan(0)
  expect(service(1).getByText(/package.json의 engines.node/)).toBeTruthy()
  expect(screen.getByText('자동으로 정하지 못한 칸이 있어요. 칸 아래 안내를 보고 골라 주세요.')).toBeTruthy()
})

it('shows no pick-a-value banner when the draft decided every field', async () => {
  respond([feProject])
  renderConfirm()
  await ready()
  expect(screen.queryByText(/자동으로 정하지 못한 칸이 있어요/)).toBeNull()
})

it('hides the build fields when a Dockerfile is chosen and shows them again without one', async () => {
  respond([beProject])
  renderConfirm({ dockerfiles: ['BE/Dockerfile'] })
  await ready()
  expect(service(1).queryByRole('combobox', { name: '프레임워크' })).toBeNull()
  expect(service(1).getByText(/Dockerfile로 빌드하므로/)).toBeTruthy()
  fireEvent.change(service(1).getByRole('combobox', { name: 'Dockerfile' }), { target: { value: '' } })
  expect(service(1).getByRole('combobox', { name: '프레임워크' })).toBeTruthy()
  expect(service(1).getByRole<HTMLInputElement>('textbox', { name: '설치 명령' }).value).toBe('pnpm install --frozen-lockfile')
})

it('fixes the port of a static site and hides the server-only lists', async () => {
  respond([feProject])
  renderConfirm()
  await ready()
  const port = service(1).getByRole<HTMLInputElement>('textbox', { name: '포트' })
  expect(port.value).toBe('8080')
  expect(port.disabled).toBe(true)
  expect(service(1).queryByRole('group', { name: '환경변수' })).toBeNull()
  expect(service(1).queryByRole('group', { name: '비밀값 이름' })).toBeNull()
  fireEvent.change(service(1).getByRole('combobox', { name: '실행 방식' }), { target: { value: 'server' } })
  expect(service(1).getByRole('group', { name: '비밀값 이름' })).toBeTruthy()
  // 서버로 되돌리면 정적일 때의 8080이 아니라 사용자가 적은 포트가 남는다.
  expect(service(1).getByRole<HTMLInputElement>('textbox', { name: '포트' }).value).toBe('')
  fireEvent.change(service(1).getByRole('textbox', { name: '포트' }), { target: { value: '3000' } })
  fireEvent.change(service(1).getByRole('combobox', { name: '실행 방식' }), { target: { value: 'static' } })
  expect(service(1).getByRole<HTMLInputElement>('textbox', { name: '포트' }).value).toBe('8080')
  fireEvent.change(service(1).getByRole('combobox', { name: '실행 방식' }), { target: { value: 'server' } })
  expect(service(1).getByRole<HTMLInputElement>('textbox', { name: '포트' }).value).toBe('3000')
})

it('starts a Vite folder that has a Dockerfile as a server and asks for the port the container listens on', async () => {
  respond([feProject])
  renderConfirm({ dockerfiles: ['FE/Dockerfile'] })
  await ready()
  expect(service(1).getByRole<HTMLSelectElement>('combobox', { name: '실행 방식' }).value).toBe('server')
  expect(service(1).getByText(/Dockerfile의 컨테이너가 받는 포트/)).toBeTruthy()
})

it('warns that a static service with a Dockerfile must serve on 8080, and only then', async () => {
  respond([feProject])
  renderConfirm({ dockerfiles: ['FE/Dockerfile'] })
  await ready()
  fireEvent.change(service(1).getByRole('combobox', { name: '실행 방식' }), { target: { value: 'static' } })
  expect(service(1).getByText(/Dockerfile로 빌드한 컨테이너가 8080에서 서빙해야 해요/)).toBeTruthy()
  fireEvent.change(service(1).getByRole('combobox', { name: 'Dockerfile' }), { target: { value: '' } })
  expect(service(1).queryByText(/Dockerfile로 빌드한 컨테이너가/)).toBeNull()
  expect(service(1).getByText('정적 사이트는 8080 고정')).toBeTruthy()
})

it('blocks confirm and shows the reason when the repo has no commit, without asking for a draft', () => {
  renderConfirm({ commit: null })
  expect(screen.getByText('이 레포에는 아직 commit이 없어요')).toBeTruthy()
  expect((confirmButton() as HTMLButtonElement).disabled).toBe(true)
  expect(api.apiFetch).not.toHaveBeenCalled()
})

it('says plainly that no Node project was found, and offers to add a service by hand', async () => {
  respond([])
  renderConfirm({ dockerfiles: ['Dockerfile'] })
  expect(await screen.findByText(/Node 프로젝트\(package.json\)를 찾지 못했어요/)).toBeTruthy()
  expect(screen.getByText(/서비스를 직접 추가할 수 있어요/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '서비스 추가' }))
  expect(await ready()).toBeTruthy()
})

it('warns that a truncated draft is not complete', async () => {
  respond([feProject], undefined, true)
  renderConfirm()
  expect(await screen.findByText('레포가 커서 일부만 확인했어요')).toBeTruthy()
  expect(screen.getByText(/없다고 말할 수 없으니/)).toBeTruthy()
})

it('starts with three services when the draft has more and lets the user add the others', async () => {
  const folders = ['A', 'B', 'C', 'D'].map((dir, i) => ({ ...feProject, dir, framework: { value: 'nextjs', source: 'package.json' }, port: { value: 3000 + i, source: 'default' } }))
  respond(folders)
  renderConfirm()
  await ready()
  expect(screen.getByText(/폴더를 4개 찾았어요/)).toBeTruthy()
  expect(screen.queryByRole('region', { name: '서비스 4' })).toBeNull()
  expect(screen.queryByRole('button', { name: '서비스 추가' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '서비스 3 빼기' }))
  fireEvent.change(screen.getByRole('combobox', { name: '추가할 폴더' }), { target: { value: 'D' } })
  fireEvent.click(screen.getByRole('button', { name: '서비스 추가' }))
  expect(service(3).getByRole<HTMLInputElement>('textbox', { name: '폴더' }).value).toBe('D')
})

it('keeps the roles of the services different by telling the user in the form, without calling the server', async () => {
  respond([feProject, { ...feProject, dir: 'WEB' }])
  renderConfirm()
  await ready()
  fireEvent.change(service(2).getByRole('textbox', { name: '이름' }), { target: { value: 'web' } })
  fireEvent.click(confirmButton())
  // 역할(fe)과 공개 경로(/)가 둘 다 겹친다.
  await waitFor(() => { expect(service(2).getByRole('combobox', { name: '역할' }).getAttribute('aria-invalid')).toBe('true') })
  expect(service(2).getByRole('textbox', { name: '공개 경로' }).getAttribute('aria-invalid')).toBe('true')
  expect(service(1).getByRole('combobox', { name: '역할' }).getAttribute('aria-invalid')).toBeNull()
  expect(screen.getByText('2곳을 고쳐 주세요')).toBeTruthy()
  expect(calls('/api/deploys')).toHaveLength(0)
})

it('shows what is missing on the fields and does not save', async () => {
  respond([beProject])
  renderConfirm()
  await ready()
  fireEvent.click(confirmButton())
  expect(await service(1).findAllByText('입력해 주세요')).not.toHaveLength(0)
  expect(calls('/api/deploys')).toHaveLength(0)
})

it('saves with the commit from the check, unchanged, and shows what was saved', async () => {
  respond([feProject], saved)
  renderConfirm()
  await ready()
  fireEvent.click(confirmButton())
  expect(await screen.findByText('배포 설정을 저장했어요')).toBeTruthy()
  const [, body] = calls('/api/deploys')[0] as [string, { repoUrl: string; commit: string; spec: { project: unknown; services: { name: string }[] } }]
  expect(body.repoUrl).toBe(REPO_URL)
  expect(body.commit).toBe(COMMIT)
  expect(body.spec.project).toEqual({ slug: 'my-app', repo: 'student/my-app' })
  expect(body.spec.services[0]?.name).toBe('fe')
  expect(screen.getByText('dep-1')).toBeTruthy()
  expect(screen.getByRole('link', { name: '배포 진행 화면으로 가기' }).getAttribute('href')).toBe('/deploys/dep-1')
  expect(screen.getByText(COMMIT.slice(0, 7))).toBeTruthy()
  expect(screen.queryByText(/비밀값을 넣을 차례/)).toBeNull()
  // 저장한 뒤에는 폼이 사라지고 같은 입력을 또 보낼 수 없다.
  expect(screen.queryByRole('button', { name: '배포 설정 확정' })).toBeNull()
})

it('lists the secret names that were saved and says the values come in the next step', async () => {
  respond([{ ...feProject, framework: { value: 'nextjs', source: 'package.json' }, port: { value: 3000, source: 'default' } }], saved)
  renderConfirm()
  await ready()
  fireEvent.change(service(1).getByRole('combobox', { name: '역할' }), { target: { value: 'be' } })
  fireEvent.change(service(1).getByRole('textbox', { name: '시작 명령' }), { target: { value: 'pnpm start' } })
  fireEvent.click(service(1).getByRole('button', { name: '비밀값 이름 추가' }))
  fireEvent.change(service(1).getByRole('textbox', { name: '비밀값 이름 1' }), { target: { value: 'DATABASE_URL' } })
  fireEvent.click(confirmButton())
  expect(await screen.findByText('비밀값을 넣을 차례가 남았어요')).toBeTruthy()
  expect(screen.getByText('be: DATABASE_URL')).toBeTruthy()
})

it('locks the form and the button while saving', async () => {
  api.apiFetch.mockImplementation((path: string) => (path === '/api/repos/deploy-spec' ? Promise.resolve(draftOf([feProject])) : new Promise(() => undefined)))
  renderConfirm()
  await ready()
  fireEvent.click(confirmButton())
  const busy = await screen.findByRole('button', { name: '저장하는 중…' })
  expect((busy as HTMLButtonElement).disabled).toBe(true)
  expect(busy.getAttribute('aria-busy')).toBe('true')
  expect(service(1).getByRole<HTMLInputElement>('textbox', { name: '이름' }).disabled).toBe(true)
})

it('shows each field error of INVALID_SPEC on its own input, by code and not by message', async () => {
  rejectSave(
    new ApiError(400, 'INVALID_SPEC', 'spec has invalid fields (first: whatever)', [
      { path: 'services[0].runtime.health.startupTimeoutSeconds', code: 'OUT_OF_RANGE' },
      { path: 'project.slug', code: 'RESERVED' },
      { path: 'services[0].runtime.resources', code: 'INVALID_VALUE' },
    ]),
  )
  renderConfirm()
  await ready()
  fireEvent.click(confirmButton())
  expect(await service(1).findByText('허용 범위를 벗어났어요')).toBeTruthy()
  const slug = screen.getByRole('textbox', { name: /프로젝트 이름/ })
  expect(slug.getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByText('예약된 이름이라 쓸 수 없어요')).toBeTruthy()
  // 입력칸이 없는 칸은 요약에 경로와 함께 적는다.
  expect(screen.getByText('3곳을 고쳐 주세요')).toBeTruthy()
  expect(screen.getByText('services[0].runtime.resources')).toBeTruthy()
})

it('shows the env row error at the key the server names', async () => {
  rejectSave(new ApiError(400, 'INVALID_SPEC', 'x', [{ path: 'services[0].build.buildEnv.VITE_KEY', code: 'CONFLICT' }]))
  renderConfirm()
  await ready()
  fireEvent.click(service(1).getByRole('button', { name: '빌드 환경변수 추가' }))
  fireEvent.change(service(1).getByRole('textbox', { name: '빌드 환경변수 이름 1' }), { target: { value: 'VITE_KEY' } })
  fireEvent.click(confirmButton())
  expect(await service(1).findByText('다른 칸과 맞지 않아요')).toBeTruthy()
})

it('ties the row error and the whole-list error to their inputs for assistive technology', async () => {
  rejectSave(
    new ApiError(400, 'INVALID_SPEC', 'x', [
      { path: 'services[0].build.buildEnv.VITE_KEY', code: 'CONFLICT' },
      { path: 'services[0].build.buildEnv', code: 'DUPLICATE' },
    ]),
  )
  renderConfirm()
  await ready()
  fireEvent.click(service(1).getByRole('button', { name: '빌드 환경변수 추가' }))
  fireEvent.change(service(1).getByRole('textbox', { name: '빌드 환경변수 이름 1' }), { target: { value: 'VITE_KEY' } })
  fireEvent.click(confirmButton())
  const row = await service(1).findByText('다른 칸과 맞지 않아요')
  const input = service(1).getByRole('textbox', { name: '빌드 환경변수 이름 1' })
  expect(input.getAttribute('aria-describedby')).toBe(row.id)
  expect(row.id).not.toBe('')
  const list = service(1).getByRole('group', { name: '빌드 환경변수' })
  const listError = within(list).getByText('다른 칸과 겹쳐요')
  expect(list.getAttribute('aria-describedby')).toBe(listError.id)
  expect(listError.id).not.toBe('')
  // 오류가 없는 줄에는 설명을 달지 않는다.
  expect(service(1).getByRole('textbox', { name: '빌드 환경변수 값 1' }).getAttribute('aria-describedby')).toBeNull()
})

it('clears the server errors when the form is edited', async () => {
  rejectSave(new ApiError(400, 'INVALID_SPEC', 'x', [{ path: 'project.slug', code: 'RESERVED' }]))
  renderConfirm()
  await ready()
  fireEvent.click(confirmButton())
  expect(await screen.findByText('예약된 이름이라 쓸 수 없어요')).toBeTruthy()
  fireEvent.change(screen.getByRole('textbox', { name: /프로젝트 이름/ }), { target: { value: 'my-app-2' } })
  expect(screen.queryByText('예약된 이름이라 쓸 수 없어요')).toBeNull()
})

it('puts SLUG_TAKEN on the slug field', async () => {
  rejectSave(new ApiError(409, 'SLUG_TAKEN', 'x'))
  renderConfirm()
  await ready()
  fireEvent.click(confirmButton())
  expect(await screen.findByText('이미 다른 배포가 쓰는 이름이에요')).toBeTruthy()
  expect(screen.getByRole('textbox', { name: /프로젝트 이름/ }).getAttribute('aria-invalid')).toBe('true')
})

it('tells the user to try again on DATABASE_UNAVAILABLE and sends the same input again', async () => {
  rejectSave(new ApiError(503, 'DATABASE_UNAVAILABLE', 'x'))
  renderConfirm()
  await ready()
  fireEvent.click(confirmButton())
  expect(await screen.findByText('저장하지 못했어요')).toBeTruthy()
  expect(screen.getByText(/사용자 잘못이 아니에요/)).toBeTruthy()
  fireEvent.click(confirmButton())
  await waitFor(() => { expect(calls('/api/deploys')).toHaveLength(2) })
  expect(calls('/api/deploys')[1]).toEqual(calls('/api/deploys')[0])
})

it('says the GitHub limit is used up (not "could not connect") on GITHUB_RATE_LIMITED at save time, and lets the user try again', async () => {
  rejectSave(new ApiError(503, 'GITHUB_RATE_LIMITED', 'x'))
  renderConfirm()
  await ready()
  fireEvent.click(confirmButton())
  expect(await screen.findByText('GitHub 조회 한도를 잠시 다 썼어요')).toBeTruthy()
  expect(screen.queryByText('저장하지 못했어요')).toBeNull()
  fireEvent.click(confirmButton())
  await waitFor(() => { expect(calls('/api/deploys')).toHaveLength(2) })
})

it('sends the user back to the check when the commit is gone at save time', async () => {
  rejectSave(new ApiError(404, 'COMMIT_NOT_FOUND', 'x'))
  renderConfirm()
  await ready()
  fireEvent.click(confirmButton())
  expect(await screen.findByText('접수한 뒤 레포가 바뀌었어요')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '레포 다시 확인하기' }))
  expect(onRecheck).toHaveBeenCalledTimes(1)
})

it('sends the user back to the check when the commit is gone while building the draft', async () => {
  api.apiFetch.mockRejectedValue(new ApiError(404, 'COMMIT_NOT_FOUND', 'x'))
  renderConfirm()
  expect(await screen.findByText('접수한 뒤 레포가 바뀌었어요')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '레포 다시 확인하기' }))
  expect(onRecheck).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: '다시 시도하기' })).toBeNull()
})

it('retries the draft only when the user asks, after GITHUB_UNAVAILABLE', async () => {
  api.apiFetch.mockRejectedValueOnce(new ApiError(503, 'GITHUB_UNAVAILABLE', 'x'))
  renderConfirm()
  expect(await screen.findByText('배포 설정 초안을 만들지 못했어요')).toBeTruthy()
  expect(calls('/api/repos/deploy-spec')).toHaveLength(1)
  api.apiFetch.mockResolvedValue(draftOf([feProject]))
  fireEvent.click(screen.getByRole('button', { name: '다시 시도하기' }))
  expect(await ready()).toBeTruthy()
  expect(calls('/api/repos/deploy-spec')).toHaveLength(2)
})

it('shows the ownership failure without a retry button', async () => {
  api.apiFetch.mockRejectedValue(new ApiError(403, 'REPO_NOT_OWNED', 'x'))
  renderConfirm()
  expect(await screen.findByText('내 GitHub 계정의 레포가 아니에요')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '다시 시도하기' })).toBeNull()
})
