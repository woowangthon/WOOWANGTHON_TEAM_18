import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { callPlatform, deployIdFromEnv, exitCodeOf, PlatformError, platformFromEnv, RETRY_WAITS_MS } from './platform-api.js'
import { DEPLOY_ID, fakePlatform, TOKEN } from './platform-fake.js'

describe('platformFromEnv', () => {
  const env = (over: Record<string, string | undefined> = {}) => ({ PLATFORM_API_URL: 'https://api.stairnoworks.com', PIPELINE_NOTIFY_TOKEN: TOKEN, ...over })

  it('reads the server address and the token', () => {
    const conn = platformFromEnv(env())
    expect(conn.url.href).toBe('https://api.stairnoworks.com/')
    expect(conn.token).toBe(TOKEN)
  })

  it.each(['http://127.0.0.1:3000', 'http://localhost:3000', 'http://[::1]:3000'])('allows plain http on loopback (%s) for the GoCD server on the same host', (url) => {
    expect(() => platformFromEnv(env({ PLATFORM_API_URL: url }))).not.toThrow()
  })

  it.each([undefined, '', 'http://api.stairnoworks.com', 'http://10.0.0.5:3000', 'https://api.stairnoworks.com/api', 'https://api.stairnoworks.com/?x=1', 'https://u:p@api.stairnoworks.com', 'ftp://h', 'not a url'])(
    'refuses PLATFORM_API_URL %s',
    (url) => {
      expect(() => platformFromEnv(env({ PLATFORM_API_URL: url }))).toThrow('PLATFORM_API_URL must look like https://api.stairnoworks.com')
    },
  )

  it.each([undefined, '', 'x'.repeat(31), `${'x'.repeat(16)} ${'x'.repeat(16)}`, `${'x'.repeat(31)}\n`])('refuses a token that is %j, without printing it', (token) => {
    expect(() => platformFromEnv(env({ PIPELINE_NOTIFY_TOKEN: token }))).toThrow(/^PIPELINE_NOTIFY_TOKEN must look like a token of 32 or more characters without spaces$/)
  })
})

describe('deployIdFromEnv', () => {
  it('takes a UUID and lowercases it', () => {
    const lower = 'abcdef12-abcd-4abc-8abc-abcdef123456'
    expect(deployIdFromEnv({ DEPLOY_ID: lower.toUpperCase() })).toBe(lower)
    expect(deployIdFromEnv({ DEPLOY_ID: DEPLOY_ID })).toBe(DEPLOY_ID)
  })

  it.each([undefined, '', 'nope', `${DEPLOY_ID}/../x`, `${DEPLOY_ID}\n`])('refuses DEPLOY_ID %j (it goes into a request path)', (v) => {
    expect(() => deployIdFromEnv({ DEPLOY_ID: v })).toThrow('DEPLOY_ID must look like a UUID')
  })
})

describe('callPlatform', () => {
  let platform: Awaited<ReturnType<typeof fakePlatform>> | undefined
  const waits: number[] = []
  const sleep = (ms: number) => {
    waits.push(ms)
    return Promise.resolve()
  }
  const conn = () => ({ url: new URL(platform!.url), token: TOKEN })
  afterEach(async () => {
    waits.length = 0
    await platform?.close()
    platform = undefined
  })

  it('sends the token only in the Authorization header, and the body as JSON', async () => {
    platform = await fakePlatform(() => ({ status: 200, body: { ok: true } }))
    expect(await callPlatform(conn(), 'POST', '/api/pipeline/notify', { a: 1 }, sleep)).toEqual({ ok: true })
    const [req] = platform.seen
    expect(req).toMatchObject({ method: 'POST', url: '/api/pipeline/notify', body: '{"a":1}' })
    expect(req.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(req.headers['content-type']).toBe('application/json')
    expect(`${req.url}${req.body}`).not.toContain(TOKEN)
  })

  it('sends a GET without a body', async () => {
    platform = await fakePlatform(() => ({ status: 200, body: {} }))
    await callPlatform(conn(), 'GET', '/api/pipeline/deploys/x/input', undefined, sleep)
    expect(platform.seen[0]).toMatchObject({ method: 'GET', body: '' })
    expect(platform.seen[0].headers['content-type']).toBeUndefined()
  })

  it('tries again on 503 with growing waits, and returns the answer of the attempt that worked', async () => {
    platform = await fakePlatform((_, n) => (n < 2 ? { status: 503, body: { error: { code: 'DATABASE_UNAVAILABLE' } } } : { status: 200, body: { ok: true } }))
    expect(await callPlatform(conn(), 'POST', '/p', {}, sleep)).toEqual({ ok: true })
    expect(platform.seen).toHaveLength(3)
    expect(waits).toEqual([1_000, 2_000])
  })

  it('gives up when 503 lasts: one try plus one per wait, and says how many', async () => {
    platform = await fakePlatform(() => ({ status: 503, body: { error: { code: 'DATABASE_UNAVAILABLE' } } }))
    const err = await callPlatform(conn(), 'POST', '/p', {}, sleep).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlatformError)
    expect(err).toMatchObject({ status: 503, message: 'POST /p answered 503: DATABASE_UNAVAILABLE, tried 4 times' })
    expect(platform.seen).toHaveLength(RETRY_WAITS_MS.length + 1)
    expect(waits).toEqual(RETRY_WAITS_MS)
  })

  it('tries again when the connection fails, then says it did not reach the server', async () => {
    platform = await fakePlatform(() => ({ status: 200 }))
    const c = conn()
    await platform.close()
    const err = await callPlatform(c, 'GET', '/p', undefined, sleep).catch((e: unknown) => e)
    expect(err).toMatchObject({ status: null, message: 'GET /p did not reach the platform server (ECONNREFUSED), tried 4 times' })
    expect(waits).toEqual(RETRY_WAITS_MS)
    platform = undefined
  })

  it('does not wait forever for a server that never answers (timeout counts as a failed try)', async () => {
    const slow = await hangingServer()
    const err = await callPlatform({ url: new URL(slow.url), token: TOKEN }, 'GET', '/p', undefined, sleep, 50).catch((e: unknown) => e)
    await slow.close()
    expect(err).toMatchObject({ status: null, message: expect.stringContaining('TimeoutError') as string })
    expect(waits).toEqual(RETRY_WAITS_MS)
  })

  it.each([400, 401, 404, 409])('does not try again on %i and carries the status', async (status) => {
    platform = await fakePlatform(() => ({ status, body: { error: { code: 'X_CODE' } } }))
    const err = await callPlatform(conn(), 'POST', '/p', {}, sleep).catch((e: unknown) => e)
    expect(err).toMatchObject({ status, message: `POST /p answered ${status}: X_CODE` })
    expect(platform.seen).toHaveLength(1)
    expect(waits).toEqual([])
  })

  it('names the fields the server asked to fix on a 400', async () => {
    const fields = [{ path: 'failure.raw.k8s.status', code: 'REQUIRED' }, { path: 'images.fe', code: 'INVALID_VALUE' }]
    platform = await fakePlatform(() => ({ status: 400, body: { error: { code: 'BAD_REQUEST', message: 'x', fields } } }))
    const err = await callPlatform(conn(), 'POST', '/p', {}, sleep).catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 400, fields, message: 'POST /p answered 400: BAD_REQUEST, failure.raw.k8s.status REQUIRED, images.fe INVALID_VALUE' })
  })

  it('reports a status whose body is not the error shape', async () => {
    platform = await fakePlatform(() => ({ status: 502, body: '<html>bad gateway</html>' }))
    const err = await callPlatform(conn(), 'GET', '/p', undefined, sleep).catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 502, message: 'GET /p answered 502' })
    expect(platform.seen).toHaveLength(1)
  })

  it('fails on a 200 that is not JSON', async () => {
    platform = await fakePlatform(() => ({ status: 200, body: 'ok' }))
    await expect(callPlatform(conn(), 'GET', '/p', undefined, sleep)).rejects.toThrow('GET /p answered 200 with a body that is not JSON')
  })

  it('does not follow a redirect: the other address never gets a request', async () => {
    const elsewhere = await fakePlatform(() => ({ status: 200, body: { ok: true } }))
    platform = await fakePlatform(() => ({ status: 302, headers: { Location: `${elsewhere.url}/steal` } }))
    const err = await callPlatform(conn(), 'GET', '/p', undefined, sleep).catch((e: unknown) => e)
    await elsewhere.close()
    expect(err).toBeInstanceOf(PlatformError)
    expect(elsewhere.seen).toHaveLength(0)
  })

  it('a 3xx that is not a redirect is not a success either', async () => {
    platform = await fakePlatform(() => ({ status: 300, body: { ok: true } }))
    await expect(callPlatform(conn(), 'GET', '/p', undefined, sleep)).rejects.toMatchObject({ status: 300 })
  })

  it('never puts the token in an error message', async () => {
    platform = await fakePlatform(() => ({ status: 401, body: { error: { code: 'AUTH_REQUIRED', message: `bad token ${TOKEN}` } } }))
    const err = await callPlatform(conn(), 'GET', '/p', undefined, sleep).catch((e: unknown) => e)
    expect((err as Error).message).not.toContain(TOKEN)
  })
})

describe('exitCodeOf', () => {
  it.each([
    [new PlatformError('x', 400), 1],
    [new PlatformError('x', 401), 1],
    [new PlatformError('x', 404), 1],
    [new PlatformError('x', 503), 2],
    [new PlatformError('x', 502), 2],
    [new PlatformError('x', null), 2],
    [new Error('crash'), 2],
  ])('maps %o to %i', (err, code) => {
    expect(exitCodeOf(err)).toBe(code)
  })
})

// 연결은 받지만 답하지 않는 서버.
async function hangingServer() {
  const sockets: net.Socket[] = []
  const server = net.createServer((socket) => sockets.push(socket))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`
  return {
    url,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
