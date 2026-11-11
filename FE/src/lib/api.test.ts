import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from './api.ts'

// 실제 Supabase와 BE를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
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
  // 기본값: 갱신이 안 된다(로그인이 풀렸다). 갱신이 되는 경우는 각 테스트가 정한다.
  auth.refreshSession
    .mockReset()
    .mockResolvedValue({
      data: { session: null },
      error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'),
    })
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

it('INVALID_SPEC의 fields를 칸마다의 { path, code }로 싣고, 모양이 틀린 항목은 버린다', async () => {
  fetchMock.mockResolvedValue(
    json(400, {
      error: {
        code: 'INVALID_SPEC',
        message: 'spec has invalid fields',
        fields: [
          { path: 'project.slug', code: 'RESERVED' },
          { path: 'services[0].name' },
          'x',
          { path: 'services[1].runtime.port', code: 'OUT_OF_RANGE' },
        ],
      },
    }),
  )
  const error = await failure(apiFetch('/api/deploys', {}))
  expect(error.code).toBe('INVALID_SPEC')
  expect(error.fields).toEqual([
    { path: 'project.slug', code: 'RESERVED' },
    { path: 'services[1].runtime.port', code: 'OUT_OF_RANGE' },
  ])
})

it('fields가 없는 오류는 빈 목록이다', async () => {
  fetchMock.mockResolvedValue(json(409, { error: { code: 'SLUG_TAKEN', message: 'x' } }))
  const error = await failure(apiFetch('/api/deploys', {}))
  expect(error.fields).toEqual([])
})

const sessionError = (code = 'INVALID_TOKEN') =>
  json(401, { error: { code, message: 'no' } })
const refreshed = (token: string) =>
  auth.refreshSession.mockResolvedValue({ data: { session: { access_token: token } }, error: null })
const bearerOf = (call: number) =>
  new Headers(fetchMock.mock.calls[call]?.[1]?.headers).get('Authorization')

it('401이면 갱신한 새 토큰으로 한 번 다시 보내고, 성공하면 로그아웃하지 않는다', async () => {
  refreshed('tok-2')
  fetchMock
    .mockResolvedValueOnce(sessionError())
    .mockResolvedValueOnce(json(200, { id: 'u1' }))
  expect(await apiFetch('/api/me')).toEqual({ id: 'u1' })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(bearerOf(0)).toBe('Bearer tok-1')
  expect(bearerOf(1)).toBe('Bearer tok-2')
  expect(auth.signOut).not.toHaveBeenCalled()
})

it('다시 보낸 요청도 세션 401이면 이 기기만 로그아웃하고, 더 보내지 않는다', async () => {
  refreshed('tok-2')
  // Response 본문은 한 번만 읽을 수 있어서 호출마다 새로 만든다.
  fetchMock.mockImplementation(() => Promise.resolve(sessionError('AUTH_REQUIRED')))
  const error = await failure(apiFetch('/api/me'))
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(auth.signOut).toHaveBeenCalledTimes(1)
  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  expect(error.code).toBe('AUTH_REQUIRED')
})

it.each(['AUTH_REQUIRED', 'INVALID_TOKEN'])('401 %s에서 갱신이 거부되면 이 기기만 로그아웃한다', async (code) => {
  fetchMock.mockResolvedValue(sessionError(code))
  const error = await failure(apiFetch('/api/me'))
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(auth.signOut).toHaveBeenCalledTimes(1)
  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  expect(error.code).toBe(code)
})

it('갱신이 오프라인 · 서버 장애로 못 됐으면 로그아웃하지 않고 NETWORK_ERROR로 던진다', async () => {
  auth.refreshSession.mockResolvedValue({
    data: { session: null },
    error: new AuthRetryableFetchError('offline', 0),
  })
  fetchMock.mockResolvedValue(sessionError())
  const error = await failure(apiFetch('/api/me'))
  expect(error.status).toBe(0)
  expect(error.code).toBe('NETWORK_ERROR')
  expect(auth.signOut).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('함께 나간 요청이 이미 갱신했으면 다시 갱신하지 않고 그 토큰으로 다시 보낸다', async () => {
  auth.getSession
    .mockResolvedValueOnce({ data: { session: { access_token: 'tok-1' } } })
    .mockResolvedValueOnce({ data: { session: { access_token: 'tok-9' } } })
  fetchMock
    .mockResolvedValueOnce(sessionError())
    .mockResolvedValueOnce(json(200, { id: 'u1' }))
  expect(await apiFetch('/api/me')).toEqual({ id: 'u1' })
  expect(auth.refreshSession).not.toHaveBeenCalled()
  expect(bearerOf(1)).toBe('Bearer tok-9')
  expect(auth.signOut).not.toHaveBeenCalled()
})

it('다시 보낸 요청이 503이면 그 오류를 던지고 로그아웃하지 않는다', async () => {
  refreshed('tok-2')
  fetchMock
    .mockResolvedValueOnce(sessionError())
    .mockResolvedValueOnce(json(503, { error: { code: 'AUTH_UNAVAILABLE', message: 'down' } }))
  const error = await failure(apiFetch('/api/me'))
  expect(error.status).toBe(503)
  expect(auth.signOut).not.toHaveBeenCalled()
})

it('세션이 없었으면 갱신을 시도하지 않는다', async () => {
  auth.getSession.mockResolvedValue({ data: { session: null } })
  fetchMock.mockResolvedValue(sessionError('AUTH_REQUIRED'))
  await failure(apiFetch('/api/me'))
  expect(auth.refreshSession).not.toHaveBeenCalled()
})

it('401이어도 세션 코드가 아니면 로그아웃시키지 않는다', async () => {
  fetchMock.mockResolvedValue(json(401, { error: { code: 'SOMETHING_ELSE', message: 'no' } }))
  await failure(apiFetch('/api/me'))
  expect(auth.signOut).not.toHaveBeenCalled()
  expect(auth.refreshSession).not.toHaveBeenCalled()
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
