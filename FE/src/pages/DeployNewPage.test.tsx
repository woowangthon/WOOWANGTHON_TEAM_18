import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api.ts'
import DeployNewPage from './DeployNewPage.tsx'

// 실제 BE를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  apiFetch: api.apiFetch,
}))

beforeEach(() => {
  api.apiFetch.mockReset()
})

const renderPage = () =>
  render(
    <MemoryRouter>
      <DeployNewPage />
    </MemoryRouter>,
  )
const urlInput = () => screen.getByRole('textbox', { name: '레포 주소' })
const checkButton = () => screen.getByRole('button', { name: '레포 확인' })
const submit = (value: string) => {
  fireEvent.change(urlInput(), { target: { value } })
  fireEvent.click(checkButton())
}
const rejectWith = (status: number, code: string) =>
  api.apiFetch.mockRejectedValue(new ApiError(status, code, 'x'))
// 확인(check)을 통과하면 이어서 Dockerfile 확인(dockerfiles)도 부른다. 경로별로 답한다.
const passCheck = (dockerfiles: string[] = ['Dockerfile']) =>
  api.apiFetch.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/api/repos/dockerfiles'
        ? { repo: 'student/my-app', dockerfiles, truncated: false }
        : { repo: 'student/my-app' },
    ),
  )

it('shows the title, the field with its hint and the check button', () => {
  renderPage()
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('새 배포 요청')
  expect(screen.getByText('공개 개인 레포만 지원해요.')).toBeTruthy()
  expect(checkButton()).toBeTruthy()
})

it('asks for an address without calling the server when the field is empty', () => {
  renderPage()
  fireEvent.click(checkButton())
  expect(screen.getByText('레포 주소를 입력해 주세요')).toBeTruthy()
  expect(api.apiFetch).not.toHaveBeenCalled()
})

it('sends the trimmed address and shows the repo that passed', async () => {
  passCheck()
  renderPage()
  submit('  https://github.com/student/my-app  ')
  expect(await screen.findByText('student/my-app')).toBeTruthy()
  expect(api.apiFetch).toHaveBeenCalledWith('/api/repos/check', {
    repoUrl: 'https://github.com/student/my-app',
  })
  expect(screen.getByText('공개 레포예요')).toBeTruthy()
  expect(screen.getByText('내 계정의 레포예요')).toBeTruthy()
})

it('locks the field and button while checking', async () => {
  api.apiFetch.mockReturnValue(new Promise(() => undefined))
  renderPage()
  submit('https://github.com/student/my-app')
  const busy = await screen.findByRole('button', { name: '확인하는 중…' })
  expect((busy as HTMLButtonElement).disabled).toBe(true)
  expect(busy.getAttribute('aria-busy')).toBe('true')
  expect((urlInput() as HTMLInputElement).disabled).toBe(true)
})

it('clears the passed result when the address is edited', async () => {
  passCheck()
  renderPage()
  submit('https://github.com/student/my-app')
  await screen.findByText('student/my-app')
  fireEvent.change(urlInput(), { target: { value: 'https://github.com/student/other' } })
  expect(screen.queryByText('student/my-app')).toBeNull()
})

it('puts a malformed address error on the field', async () => {
  rejectWith(400, 'INVALID_REPO_URL')
  renderPage()
  submit('github.com/x')
  expect(
    await screen.findByText('올바른 GitHub 레포 주소가 아니에요. 예: https://github.com/소유자/레포'),
  ).toBeTruthy()
  expect(urlInput().getAttribute('aria-invalid')).toBe('true')
})

it('clears the field error and the failure alert when the address is edited', async () => {
  rejectWith(400, 'INVALID_REPO_URL')
  renderPage()
  submit('github.com/x')
  await screen.findByText('올바른 GitHub 레포 주소가 아니에요. 예: https://github.com/소유자/레포')
  fireEvent.change(urlInput(), { target: { value: 'github.com/xy' } })
  expect(screen.queryByText(/올바른 GitHub 레포 주소가 아니에요/)).toBeNull()
  expect(urlInput().getAttribute('aria-invalid')).not.toBe('true')

  rejectWith(404, 'REPO_NOT_FOUND')
  submit('https://github.com/student/missing')
  await screen.findByText('레포를 찾을 수 없어요')
  fireEvent.change(urlInput(), { target: { value: 'https://github.com/student/other' } })
  expect(screen.queryByText('레포를 찾을 수 없어요')).toBeNull()
})

it('GITHUB_NOT_LINKED points to the profile page', async () => {
  rejectWith(403, 'GITHUB_NOT_LINKED')
  renderPage()
  submit('https://github.com/student/my-app')
  expect(await screen.findByText('먼저 프로필에서 GitHub를 연동해 주세요.')).toBeTruthy()
  expect(screen.getByRole('link', { name: '프로필로 이동' }).getAttribute('href')).toBe('/profile')
})

it.each([
  [403, 'REPO_NOT_OWNED', '내 GitHub 계정의 레포가 아니에요'],
  [404, 'REPO_NOT_FOUND', '레포를 찾을 수 없어요'],
  [422, 'REPO_NOT_PERSONAL', '지금은 개인 레포만 지원해요'],
  [503, 'GITHUB_UNAVAILABLE', '서버와 연결하지 못했어요'],
  [503, 'AUTH_UNAVAILABLE', '서버와 연결하지 못했어요'],
  [0, 'NETWORK_ERROR', '서버와 연결하지 못했어요'],
  [500, 'HTTP_500', '레포를 확인하지 못했어요'],
])('%i %s shows "%s" and no passed result', async (status, code, title) => {
  rejectWith(status, code)
  renderPage()
  submit('https://github.com/student/my-app')
  expect(await screen.findByText(title)).toBeTruthy()
  expect(screen.queryByText('공개 레포예요')).toBeNull()
  expect(screen.queryByRole('link', { name: '프로필로 이동' })).toBeNull()
})

it('an unexpected non-API error is shown as the generic failure', async () => {
  api.apiFetch.mockRejectedValue(new Error('boom'))
  renderPage()
  submit('https://github.com/student/my-app')
  expect(await screen.findByText('레포를 확인하지 못했어요')).toBeTruthy()
})

it('can check again after a failure and the old error goes away', async () => {
  rejectWith(503, 'GITHUB_UNAVAILABLE')
  renderPage()
  submit('https://github.com/student/my-app')
  await screen.findByText('서버와 연결하지 못했어요')
  passCheck()
  fireEvent.click(checkButton())
  expect(await screen.findByText('student/my-app')).toBeTruthy()
  expect(screen.queryByText('서버와 연결하지 못했어요')).toBeNull()
})

it('checks for Dockerfiles only after the repo check passed', async () => {
  passCheck(['BE/Dockerfile'])
  renderPage()
  submit('https://github.com/student/my-app')
  expect(await screen.findByText('BE/Dockerfile')).toBeTruthy()
  expect(api.apiFetch.mock.calls.map((call) => String(call[0]))).toEqual([
    '/api/repos/check',
    '/api/repos/dockerfiles',
  ])
})

it('does not look for Dockerfiles when the repo check fails', async () => {
  rejectWith(403, 'REPO_NOT_OWNED')
  renderPage()
  submit('https://github.com/student/my-app')
  await screen.findByText('내 GitHub 계정의 레포가 아니에요')
  expect(api.apiFetch).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('heading', { name: 'Dockerfile' })).toBeNull()
})

it('hides the Dockerfile section when the address is edited after a pass', async () => {
  passCheck()
  renderPage()
  submit('https://github.com/student/my-app')
  await screen.findByRole('heading', { name: 'Dockerfile' })
  fireEvent.change(urlInput(), { target: { value: 'https://github.com/student/other' } })
  expect(screen.queryByRole('heading', { name: 'Dockerfile' })).toBeNull()
})
