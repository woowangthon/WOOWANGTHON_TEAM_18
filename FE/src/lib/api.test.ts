import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from './api.ts'

// 실제 Supabase와 BE를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('./supabase.ts', () => ({ supabase: { auth } }))

const fetchMock = vi.fn<typeof fetch>()

const withSession = () =>
  auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok-1' } } })

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// 실패를 던지는 호출을 한 번만 실행해 ApiError를 돌려준다.
async function failure(call: Promise<unknown>) {
  try {
    await call
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('expected apiFetch to throw')
}

beforeEach(() => {
  auth.getSession.mockReset()
  auth.signOut.mockReset().mockResolvedValue({ error: null })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  withSession()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('세션이 있으면 Bearer 토큰을 붙인다', async () => {
  fetchMock.mockResolvedValue(json(200, { ok: true }))
  await apiFetch('/api/me')
  const init = fetchMock.mock.calls[0]?.[1]
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tok-1')
})

it('세션이 없으면 헤더 없이 보내고 BE의 401을 그대로 받는다', async () => {
  auth.getSession.mockResolvedValue({ data: { session: null } })
  fetchMock.mockResolvedValue(
    json(401, { error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } }),
  )
  const error = await failure(apiFetch('/api/me'))
  expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('Authorization')).toBe(false)
  expect(error.code).toBe('AUTH_REQUIRED')
})

it('body가 없으면 GET, 성공 본문을 JSON으로 돌려준다', async () => {
  fetchMock.mockResolvedValue(json(200, { id: 'u1' }))
  const result = await apiFetch<{ id: string }>('/api/me')
  expect(result).toEqual({ id: 'u1' })
  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/me')
  expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET')
  expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined()
})

it('body가 있으면 JSON으로 POST한다', async () => {
  fetchMock.mockResolvedValue(json(200, { repo: {} }))
  await apiFetch('/api/repos/check', { repoUrl: 'https://github.com/a/b' })
  const init = fetchMock.mock.calls[0]?.[1]
  expect(init?.method).toBe('POST')
  expect(init?.body).toBe(JSON.stringify({ repoUrl: 'https://github.com/a/b' }))
  expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
})

it('오류 본문의 status, code, message를 ApiError로 던진다', async () => {
  fetchMock.mockResolvedValue(
    json(403, { error: { code: 'REPO_NOT_OWNED', message: 'Not your repo' } }),
  )
  const error = await failure(apiFetch('/api/repos/check', { repoUrl: 'x' }))
  expect(error.status).toBe(403)
  expect(error.code).toBe('REPO_NOT_OWNED')
  expect(error.message).toBe('Not your repo')
  expect(auth.signOut).not.toHaveBeenCalled()
})

it.each(['AUTH_REQUIRED', 'INVALID_TOKEN'])('401 %s이면 로그아웃시키고 오류를 던진다', async (code) => {
  fetchMock.mockResolvedValue(json(401, { error: { code, message: 'no' } }))
  const error = await failure(apiFetch('/api/me'))
  expect(auth.signOut).toHaveBeenCalledTimes(1)
  expect(error.code).toBe(code)
})

it('401이어도 세션 코드가 아니면 로그아웃시키지 않는다', async () => {
  fetchMock.mockResolvedValue(json(401, { error: { code: 'SOMETHING_ELSE', message: 'no' } }))
  await failure(apiFetch('/api/me'))
  expect(auth.signOut).not.toHaveBeenCalled()
})

it('503은 로그아웃시키지 않는다', async () => {
  fetchMock.mockResolvedValue(
    json(503, { error: { code: 'AUTH_UNAVAILABLE', message: 'down' } }),
  )
  const error = await failure(apiFetch('/api/me'))
  expect(error.status).toBe(503)
  expect(error.code).toBe('AUTH_UNAVAILABLE')
  expect(auth.signOut).not.toHaveBeenCalled()
})

it('JSON이 아닌 오류 본문은 HTTP_<상태> 코드가 되고 로그아웃시키지 않는다', async () => {
  fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }))
  const error = await failure(apiFetch('/api/me'))
  expect(error.status).toBe(502)
  expect(error.code).toBe('HTTP_502')
  expect(auth.signOut).not.toHaveBeenCalled()
})

it('error 모양이 아닌 JSON 오류 본문도 HTTP_<상태> 코드가 된다', async () => {
  fetchMock.mockResolvedValue(json(500, { oops: true }))
  const error = await failure(apiFetch('/api/me'))
  expect(error.code).toBe('HTTP_500')
})

it('네트워크 실패는 status 0 NETWORK_ERROR이고 로그아웃시키지 않는다', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
  const error = await failure(apiFetch('/api/me'))
  expect(error.status).toBe(0)
  expect(error.code).toBe('NETWORK_ERROR')
  expect(auth.signOut).not.toHaveBeenCalled()
})

it('200인데 JSON이 아닌 본문은 INVALID_RESPONSE로 던진다', async () => {
  fetchMock.mockResolvedValue(new Response('<html>spa</html>', { status: 200 }))
  const error = await failure(apiFetch('/api/me'))
  expect(error.status).toBe(200)
  expect(error.code).toBe('INVALID_RESPONSE')
})
