import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api.ts'
import DockerfileCheck from './DockerfileCheck.tsx'

// 실제 BE를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  apiFetch: api.apiFetch,
}))

const REPO_URL = 'https://github.com/student/my-app'

beforeEach(() => {
  api.apiFetch.mockReset()
})

const result = (dockerfiles: string[], truncated = false) => ({
  repo: 'student/my-app',
  dockerfiles,
  truncated,
})

it('asks the server for this repo and shows the checking state first', async () => {
  api.apiFetch.mockResolvedValue(result(['Dockerfile']))
  render(<DockerfileCheck repoUrl={REPO_URL} />)
  expect(screen.getByText('Dockerfile을 확인하는 중…')).toBeTruthy()
  await screen.findByText('Dockerfile', { selector: 'li' })
  expect(api.apiFetch).toHaveBeenCalledWith('/api/repos/dockerfiles', { repoUrl: REPO_URL })
})

it('lists every Dockerfile path', async () => {
  api.apiFetch.mockResolvedValue(result(['Dockerfile', 'BE/Dockerfile']))
  render(<DockerfileCheck repoUrl={REPO_URL} />)
  expect(await screen.findByText('BE/Dockerfile')).toBeTruthy()
  expect(screen.getByText('Dockerfile', { selector: 'li' })).toBeTruthy()
  expect(screen.queryByText('Dockerfile이 없어요.')).toBeNull()
  expect(screen.queryByText('레포가 커서 일부만 확인했어요')).toBeNull()
})

it('states only the fact when the list is empty and complete', async () => {
  api.apiFetch.mockResolvedValue(result([]))
  render(<DockerfileCheck repoUrl={REPO_URL} />)
  expect(await screen.findByText('Dockerfile이 없어요.')).toBeTruthy()
  expect(screen.queryByText('레포가 커서 일부만 확인했어요')).toBeNull()
})

it('does not claim "none" when the list is empty but truncated', async () => {
  api.apiFetch.mockResolvedValue(result([], true))
  render(<DockerfileCheck repoUrl={REPO_URL} />)
  expect(await screen.findByText('레포가 커서 일부만 확인했어요')).toBeTruthy()
  expect(screen.getByText('Dockerfile이 없다고 말할 수 없어요.')).toBeTruthy()
  expect(screen.queryByText('Dockerfile이 없어요.')).toBeNull()
})

it('shows what it found and warns the list may be partial when truncated', async () => {
  api.apiFetch.mockResolvedValue(result(['BE/Dockerfile'], true))
  render(<DockerfileCheck repoUrl={REPO_URL} />)
  expect(await screen.findByText('BE/Dockerfile')).toBeTruthy()
  expect(screen.getByText('레포가 커서 일부만 확인했어요')).toBeTruthy()
  expect(screen.getByText('찾은 Dockerfile이 전부가 아닐 수 있어요.')).toBeTruthy()
})

it.each([
  ['503 GITHUB_UNAVAILABLE', new ApiError(503, 'GITHUB_UNAVAILABLE', 'x')],
  ['network error', new ApiError(0, 'NETWORK_ERROR', 'x')],
  ['non-API error', new Error('boom')],
])('%s is a failure, never "no Dockerfile", and can be retried', async (_name, error) => {
  api.apiFetch.mockRejectedValueOnce(error).mockResolvedValueOnce(result(['Dockerfile']))
  render(<DockerfileCheck repoUrl={REPO_URL} />)
  expect(await screen.findByText('Dockerfile을 확인하지 못했어요')).toBeTruthy()
  expect(screen.queryByText('Dockerfile이 없어요.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다시 확인하기' }))
  expect(screen.getByText('Dockerfile을 확인하는 중…')).toBeTruthy()
  expect(await screen.findByText('Dockerfile', { selector: 'li' })).toBeTruthy()
  expect(api.apiFetch).toHaveBeenCalledTimes(2)
})
