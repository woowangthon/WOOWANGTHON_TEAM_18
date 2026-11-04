import { type INestApplication, Logger } from '@nestjs/common'
import { exportJWK, generateKeyPair, SignJWT, UnsecuredJWT } from 'jose'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startApp } from './start-app.js'

const ISSUER = new URL('/auth/v1', process.env.SUPABASE_URL).href
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`

// 테스트에서 만든 키. 진짜 Supabase 대신 이 키의 공개 키 목록을 fetch 자리에서 돌려준다.
const kid = 'test-key'
const signer = await generateKeyPair('ES256')
const stranger = await generateKeyPair('ES256')
const keySet = { keys: [{ ...(await exportJWK(signer.publicKey)), kid, alg: 'ES256', use: 'sig' }] }

const now = () => Math.floor(Date.now() / 1000)

// 기본값은 유효한 토큰이다. 덮어쓴 claim만 바뀌고, undefined를 주면 그 claim이 빠진다.
function token(
  claims: Record<string, unknown> = {},
  { alg = 'ES256', key = signer.privateKey }: { alg?: string; key?: Parameters<SignJWT['sign']>[0] } = {},
) {
  return new SignJWT({
    sub: 'user-1',
    email: 'student@example.com',
    iss: ISSUER,
    aud: 'authenticated',
    exp: now() + 300,
    ...claims,
  })
    .setProtectedHeader({ alg, kid })
    .setIssuedAt()
    .sign(key)
}

const fetchKeys = vi.fn<typeof fetch>()
let app: INestApplication<App>

beforeEach(async () => {
  fetchKeys.mockReset().mockImplementation(() => Promise.resolve(Response.json(keySet)))
  vi.stubGlobal('fetch', fetchKeys)
  app = await startApp()
})

afterEach(async () => {
  await app.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const me = (authorization?: string) => {
  const req = request(app.getHttpServer()).get('/api/me')
  return authorization === undefined ? req : req.set('Authorization', authorization)
}

const errorBody = (code: string) => ({ error: { code, message: expect.any(String) as string } })

describe('GET /api/me', () => {
  it('returns the user of a valid token, read with the project key set', async () => {
    await me(`Bearer ${await token()}`).expect(200, { id: 'user-1', email: 'student@example.com', isAdmin: false })
    expect(fetchKeys).toHaveBeenCalledWith(JWKS_URL, expect.anything())
  })

  it('marks an admin from app_metadata', async () => {
    const t = await token({ app_metadata: { role: 'admin' } })
    const res = await me(`Bearer ${t}`).expect(200)
    expect(res.body).toMatchObject({ isAdmin: true })
  })

  it.each([
    ['user_metadata, which the user can edit', { user_metadata: { role: 'admin' } }],
    ['another app_metadata role', { app_metadata: { role: 'student' } }],
  ])('is not admin from %s', async (_name, extra) => {
    const res = await me(`Bearer ${await token(extra)}`).expect(200)
    expect(res.body).toMatchObject({ isAdmin: false })
  })

  it('accepts the Bearer scheme in any case', async () => {
    await me(`bearer ${await token()}`).expect(200)
  })
})

describe('401 AUTH_REQUIRED', () => {
  it.each([
    ['no header', undefined],
    ['another scheme', 'Basic dXNlcjpwYXNz'],
    ['an empty bearer', 'Bearer '],
    ['a bearer with extra parts', 'Bearer a b'],
    ['a scheme glued to another word', 'xBearer abc'],
  ])('for %s', async (_name, header) => {
    const res = await me(header).expect(401)
    expect(res.body).toEqual(errorBody('AUTH_REQUIRED'))
  })
})

describe('401 INVALID_TOKEN', () => {
  const hmacKey = new TextEncoder().encode('a-shared-secret-of-thirty-two-b!')

  it.each<[string, () => Promise<string> | string]>([
    ['an expired token', () => token({ exp: now() - 60 })],
    ['a token signed by another key', () => token({}, { key: stranger.privateKey })],
    ['another issuer', () => token({ iss: 'https://other.supabase.co/auth/v1' })],
    ['another audience', () => token({ aud: 'anon' })],
    ['HS256 instead of a public key algorithm', () => token({}, { alg: 'HS256', key: hmacKey })],
    [
      'an unsigned (alg none) token',
      () => new UnsecuredJWT({ email: 'x@example.com' }).setSubject('user-1').setIssuer(ISSUER).setAudience('authenticated').encode(),
    ],
    ['no sub', () => token({ sub: undefined })],
    ['no email', () => token({ email: undefined })],
    ['garbage', () => 'not-a-jwt'],
  ])('for %s', async (_name, make) => {
    const res = await me(`Bearer ${await make()}`).expect(401)
    expect(res.body).toEqual(errorBody('INVALID_TOKEN'))
  })
})

describe('503 AUTH_UNAVAILABLE when the key set cannot be read', () => {
  it.each<[string, () => Promise<Response>]>([
    ['network error', () => Promise.reject(new TypeError('fetch failed'))],
    ['timeout', () => Promise.reject(new DOMException('timed out', 'TimeoutError'))],
    ['non-200 answer', () => Promise.resolve(new Response('down', { status: 500 }))],
    ['body that is not JSON', () => Promise.resolve(new Response('<html>'))],
    ['malformed key set', () => Promise.resolve(Response.json({ keys: 'nope' }))],
  ])('on a %s', async (_name, answer) => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    fetchKeys.mockImplementation(answer)

    const res = await me(`Bearer ${await token()}`).expect(503)
    expect(res.body).toEqual(errorBody('AUTH_UNAVAILABLE'))
    expect(log).toHaveBeenCalled()
  })
})
