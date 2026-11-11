import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api.ts'
import DeploySecrets from './DeploySecrets.tsx'
import type { SecretsState } from './secrets.ts'

// 실제 BE를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  apiFetch: api.apiFetch,
}))

const ID = '0b6f0c1e-4a52-4d8e-9a1b-3f7d2c5e8a90'
const PATH = `/api/deploys/${ID}/secrets`

const state = (be: 'in' | 'missing', ai: 'in' | 'missing'): SecretsState => ({
  ready: be === 'in' && ai === 'in',
  secretHash: be === 'in' && ai === 'in' ? `sha256:${'a'.repeat(64)}` : null,
  services: [
    { name: 'be', status: be, keys: [{ key: 'DATABASE_URL', status: be }, { key: 'JWT_SECRET', status: be }] },
    { name: 'ai', status: ai, keys: [{ key: 'OPENAI_API_KEY', status: ai }] },
  ],
})
const NONE: SecretsState = { ready: true, secretHash: null, services: [] }

beforeEach(() => {
  api.apiFetch.mockReset()
})

const show = () =>
  render(
    <MemoryRouter>
      <DeploySecrets deployId={ID} />
    </MemoryRouter>,
  )
const startLink = () => screen.queryByRole('link', { name: '배포 시작하러 가기' })
const reads = () => api.apiFetch.mock.calls.filter((c) => c[0] === PATH && c.length === 1).length
const input = (name: string) => screen.getByLabelText<HTMLInputElement>(name)
const saveButton = () => screen.getByRole('button', { name: '비밀값 저장' })

it('reads the state of this deploy and shows which service is in and which still needs values', async () => {
  api.apiFetch.mockResolvedValue(state('in', 'missing'))
  show()
  const be = within(await screen.findByRole('group', { name: /be/ }))
  expect(be.getByText('들어감')).toBeTruthy()
  expect(api.apiFetch).toHaveBeenCalledWith(PATH)
  expect(input('OPENAI_API_KEY').type).toBe('password')
  expect(screen.queryByText('빌드 준비됨')).toBeNull()
})

it('sends only the services that are not in, all their keys, with PUT, then shows what the server says', async () => {
  api.apiFetch.mockImplementation((_path: string, _body?: unknown, method?: string) =>
    method === 'PUT' ? Promise.resolve(state('in', 'in')) : Promise.resolve(state('in', 'missing')),
  )
  show()
  await screen.findByLabelText('OPENAI_API_KEY')
  fireEvent.change(input('OPENAI_API_KEY'), { target: { value: 'sk-test' } })
  fireEvent.click(saveButton())
  expect(await screen.findByText('빌드 준비됨')).toBeTruthy()
  expect(api.apiFetch).toHaveBeenCalledWith(PATH, { services: { ai: { OPENAI_API_KEY: 'sk-test' } } }, 'PUT')
  expect(screen.queryByLabelText('OPENAI_API_KEY')).toBeNull()
  expect(screen.queryByRole('button', { name: '비밀값 저장' })).toBeNull()
})

it('says build ready when everything is already in, with nothing to type', async () => {
  api.apiFetch.mockResolvedValue(state('in', 'in'))
  show()
  expect(await screen.findByText('빌드 준비됨')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '비밀값 저장' })).toBeNull()
})

it('skips the step for a deploy with no secret keys with one notice that holds the way to start', async () => {
  api.apiFetch.mockResolvedValue(NONE)
  show()
  expect(await screen.findByText('비밀값이 필요 없는 배포예요')).toBeTruthy()
  expect(screen.queryByRole('form')).toBeNull()
  // 안내는 하나뿐이고(빌드 준비됨은 따로 보이지 않는다) 시작하러 가는 길은 그 안에 있다.
  expect(screen.queryByText('빌드 준비됨')).toBeNull()
  expect(screen.getAllByRole('status')).toHaveLength(1)
  expect(within(screen.getByRole('status')).getByRole('link', { name: '배포 시작하러 가기' }).getAttribute('href')).toBe(`/deploys/${ID}`)
})

it('links to the progress screen to start the deploy once the server says ready, and not before', async () => {
  api.apiFetch.mockResolvedValue(state('in', 'missing'))
  const view = show()
  await screen.findByLabelText('OPENAI_API_KEY')
  expect(startLink()).toBeNull()
  view.unmount()

  api.apiFetch.mockResolvedValue(state('in', 'in'))
  show()
  await screen.findByText('빌드 준비됨')
  expect(startLink()?.getAttribute('href')).toBe(`/deploys/${ID}`)
})

it('keeps the typed values and reads the state again when the save fails midway, so the written service shows as in', async () => {
  const failed = new ApiError(503, 'CLUSTER_UNAVAILABLE', 'x')
  let wrote = false
  api.apiFetch.mockImplementation((_path: string, _body?: unknown, method?: string) => {
    if (method === 'PUT') {
      wrote = true
      return Promise.reject(failed)
    }
    return Promise.resolve(wrote ? state('in', 'missing') : state('missing', 'missing'))
  })
  show()
  await screen.findByLabelText('DATABASE_URL')
  fireEvent.change(input('DATABASE_URL'), { target: { value: 'a' } })
  fireEvent.change(input('JWT_SECRET'), { target: { value: 'b' } })
  fireEvent.change(input('OPENAI_API_KEY'), { target: { value: 'c' } })
  fireEvent.click(saveButton())
  expect(await screen.findByText('지금은 값을 저장할 수 없어요')).toBeTruthy()
  await waitFor(() => {
    expect(screen.queryByLabelText('DATABASE_URL')).toBeNull()
  })
  expect(within(screen.getByRole('group', { name: /be/ })).getByText('들어감')).toBeTruthy()
  expect(input('OPENAI_API_KEY').value).toBe('c')
  expect(reads()).toBe(2)
})

it('shows the problem the server named on the value when it rejects the save', async () => {
  api.apiFetch.mockImplementation((_path: string, _body?: unknown, method?: string) =>
    method === 'PUT'
      ? Promise.reject(new ApiError(400, 'INVALID_SECRETS', 'x', [{ path: 'secrets.ai.OPENAI_API_KEY', code: 'OUT_OF_RANGE' }]))
      : Promise.resolve(state('in', 'missing')),
  )
  show()
  await screen.findByLabelText('OPENAI_API_KEY')
  fireEvent.change(input('OPENAI_API_KEY'), { target: { value: 'x' } })
  fireEvent.click(saveButton())
  expect(await screen.findByText(/값이 너무 길어요/)).toBeTruthy()
  expect(input('OPENAI_API_KEY').value).toBe('x')
})

it('says the deploy was not found on 404', async () => {
  api.apiFetch.mockRejectedValue(new ApiError(404, 'DEPLOY_NOT_FOUND', 'x'))
  show()
  expect(await screen.findByText('배포를 찾을 수 없어요')).toBeTruthy()
})

it.each([
  [new ApiError(503, 'DATABASE_UNAVAILABLE', 'x'), '사용자 잘못이 아니에요'],
  [new ApiError(500, 'INTERNAL', 'x'), '잠시 뒤에 다시 시도해 주세요.'],
])('does not turn a failed read into "nothing is in" (%s), and reads again on retry', async (error, text) => {
  api.apiFetch.mockRejectedValueOnce(error).mockResolvedValue(state('in', 'in'))
  show()
  expect(await screen.findByText('비밀값 상태를 읽지 못했어요')).toBeTruthy()
  expect(screen.getByText(new RegExp(text))).toBeTruthy()
  expect(screen.queryByRole('button', { name: '비밀값 저장' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다시 읽기' }))
  expect(await screen.findByText('빌드 준비됨')).toBeTruthy()
})
