import { randomUUID } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import { Logger, ServiceUnavailableException } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { SecretWriter } from '../src/deploys/secret-writer.js'
import { combineDigests, serviceDigest } from '../src/deploys/secrets-input.js'
import { errorBody, JWKS_URL, keySet, token } from './auth-helpers.js'
import { startApp } from './start-app.js'

const REST = 'https://test.supabase.co/rest/v1/'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222'
// 서버가 읽는 칸(slug · 서비스 이름 · secretKeys)만 채운 spec. 저장소 가짜에 바로 넣는다.
type Json = Record<string, unknown>
const svc = (name: string, secretKeys: string[]) => ({ name, runtime: { secretKeys } })
const spec = (services = [svc('fe', []), svc('be', ['DATABASE_URL', 'JWT_SECRET']), svc('ai', ['OPENAI_API_KEY'])], slug = 'my-app') => ({
  project: { slug, repo: 'student/my-app' },
  services,
})
const BE = { DATABASE_URL: 'postgres://user:db-password-xyz@host/db', JWT_SECRET: 'jwt-secret-abc' }
const AI = { OPENAI_API_KEY: 'sk-openai-key-123' }
const ALL_VALUES = [...Object.values(BE), ...Object.values(AI)]

interface DeployRow {
  id: string
  user_id: string
  slug: string
  repo: string
  commit_sha: string
  spec: Json
  created_at: string
}
interface SecretRow {
  slug: string
  service: string
  keys: string[]
  status: 'writing' | 'in'
  digest: string | null
  updated_at: string
}

// 저장소(PostgREST)의 가짜: deploys는 읽기만, deploy_secrets는 읽기와 upsert. 쓴 요청의 모양도 적어 둔다.
let deploys: DeployRow[]
let secretRows: SecretRow[]
let secretWrites: { status: string; query: string; prefer: string | null; apikey: string | null }[]
// 실패 훅: Response를 주면 그 답을 대신 돌려주고, undefined면 가짜가 평소대로 답한다.
let restFail: Partial<Record<'deploys' | 'deploy_secrets', Partial<Record<'GET' | 'POST', () => Response | undefined>>>>
let logs: MockInstance[]

// SecretWriter의 가짜(실제 구현은 #111): 받은 인자를 적고, 부른 순간 저장소에 적힌 상태를 함께 적는다. fail이 오류를 주면 그것을 던진다.
let writes: { slug: string; service: string; values: Record<string, string> }[]
let statesAtWrite: string[][]
let fail: ((service: string) => Error | undefined) | undefined
const unreachable = () => new ServiceUnavailableException({ code: 'CLUSTER_UNAVAILABLE', message: 'Could not reach the cluster' })
const writer: SecretWriter = {
  write(slug, service, values) {
    writes.push({ slug, service, values: { ...values } })
    statesAtWrite.push(secretRows.map((r) => `${r.service}:${r.status}`))
    const error = fail?.(service)
    return error ? Promise.reject(error) : Promise.resolve()
  },
}

const deployRow = (over: Partial<DeployRow> = {}): DeployRow => ({
  id: randomUUID(),
  user_id: USER_ID,
  slug: 'my-app',
  repo: 'Student/My-App',
  commit_sha: '0123456789abcdef0123456789abcdef01234567',
  spec: spec(),
  created_at: '2026-11-10T01:00:00.123456+00:00',
  ...over,
})

function rest(url: URL, init: RequestInit | undefined): Response {
  const table = url.pathname.split('/').pop() as 'deploys' | 'deploy_secrets'
  const method = (init?.method ?? 'GET') as 'GET' | 'POST'
  const failed = restFail[table]?.[method]?.()
  if (failed) return failed
  const eq = (name: string) => {
    const v = url.searchParams.get(name)
    if (v === null) return undefined
    if (!v.startsWith('eq.')) throw new Error(`unexpected filter ${name}=${v}`)
    return v.slice(3)
  }
  if (table === 'deploys') {
    if (method !== 'GET') throw new Error('deploys is read only here')
    const found = deploys.filter((r) => (eq('id') ?? r.id) === r.id && (eq('user_id') ?? r.user_id) === r.user_id && (eq('slug') ?? r.slug) === r.slug)
    return Response.json(found)
  }
  if (method === 'GET') return Response.json(secretRows.filter((r) => (eq('slug') ?? r.slug) === r.slug))
  const row = JSON.parse(init?.body as string) as SecretRow
  const headers = init?.headers as Record<string, string>
  secretWrites.push({ status: row.status, query: url.search, prefer: headers.Prefer ?? null, apikey: headers.apikey ?? null })
  secretRows = secretRows.filter((r) => !(r.slug === row.slug && r.service === row.service))
  secretRows.push(row)
  return Response.json([row], { status: 201 })
}

const urlOf = (input: string | URL | Request) => (input instanceof Request ? input.url : input.toString())
const fetchMock = vi.fn<typeof fetch>((input, init) => {
  const url = urlOf(input)
  if (url === JWKS_URL) return Promise.resolve(Response.json(keySet))
  if (url.startsWith(REST)) return Promise.resolve().then(() => rest(new URL(url), init))
  return Promise.reject(new Error(`unexpected fetch ${url}`))
})

let app: INestApplication<App>

beforeEach(async () => {
  deploys = [deployRow()]
  secretRows = []
  secretWrites = []
  restFail = {}
  writes = []
  statesAtWrite = []
  fail = undefined
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  logs = (['error', 'warn', 'log', 'debug', 'verbose'] as const).map((m) => vi.spyOn(Logger.prototype, m).mockImplementation(() => undefined))
  app = await startApp([], (b) => b.overrideProvider(SecretWriter).useValue(writer))
})

afterEach(async () => {
  await app.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const bearer = async (sub = USER_ID) => `Bearer ${await token({ sub })}`
async function put(id: string, payload?: string | object, auth?: string | null, contentType = 'application/json') {
  const authorization = auth === undefined ? await bearer() : auth
  return request(app.getHttpServer())
    .put(`/api/deploys/${id}/secrets`)
    .set(authorization === null ? {} : { Authorization: authorization })
    .set('Content-Type', contentType)
    .send(payload)
}
async function get(id: string, auth?: string | null) {
  const authorization = auth === undefined ? await bearer() : auth
  return request(app.getHttpServer()).get(`/api/deploys/${id}/secrets`).set(authorization === null ? {} : { Authorization: authorization })
}
const id = () => deploys[0].id
const send = (services: object) => ({ services })

// 값이 한 곳이라도 남았는지: 응답 · 로그 · 저장소에 간 모든 것 · 저장소의 줄(리더에 쓰는 쪽 인자는 빼고).
const everywhereExceptWriter = (res: { text: string }) =>
  JSON.stringify([res.text, logs.map((l) => l.mock.calls), fetchMock.mock.calls.map(([, init]) => init?.body ?? null), secretRows])
const expectNoValues = (res: { text: string }, values = ALL_VALUES) => {
  const text = everywhereExceptWriter(res)
  for (const v of values) expect(text).not.toContain(v)
}

describe('PUT /api/deploys/:id/secrets', () => {
  it('hands the values of one service to the writer and records it as in, then answers the status without values', async () => {
    const res = await put(id(), send({ be: BE }))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ready: false,
      secretHash: null,
      services: [
        { name: 'be', status: 'in', keys: [{ key: 'DATABASE_URL', status: 'in' }, { key: 'JWT_SECRET', status: 'in' }] },
        { name: 'ai', status: 'missing', keys: [{ key: 'OPENAI_API_KEY', status: 'missing' }] },
      ],
    })
    expect(writes).toEqual([{ slug: 'my-app', service: 'be', values: BE }])
    expectNoValues(res)
  })

  it('records writing before the writer is called and in after it, with the digest of the values', async () => {
    await put(id(), send({ be: BE }))
    expect(statesAtWrite).toEqual([['be:writing']])
    expect(secretWrites.map((w) => w.status)).toEqual(['writing', 'in'])
    expect(secretRows).toEqual([
      { slug: 'my-app', service: 'be', keys: ['DATABASE_URL', 'JWT_SECRET'], status: 'in', digest: serviceDigest(BE), updated_at: expect.any(String) as string },
    ])
  })

  it('upserts with the server key on (slug, service)', async () => {
    await put(id(), send({ be: BE }))
    for (const w of secretWrites) {
      expect(w.apikey).toBe('sb_secret_test')
      expect(w.prefer).toBe('resolution=merge-duplicates,return=representation')
      expect(w.query).toBe('?on_conflict=slug%2Cservice')
    }
  })

  it('is ready with the hash once every service is in, also when the services came in two requests', async () => {
    await put(id(), send({ be: BE }))
    const res = await put(id(), send({ ai: AI }))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      ready: true,
      secretHash: combineDigests([{ name: 'be', digest: serviceDigest(BE) }, { name: 'ai', digest: serviceDigest(AI) }]),
    })
    // 이미 들어간 be는 다시 쓰지 않는다.
    expect(writes.map((w) => w.service)).toEqual(['be', 'ai'])
  })

  it('writes several services in one request, one after the other, in the order of the spec', async () => {
    const res = await put(id(), send({ ai: AI, be: BE }))
    expect(res.body).toMatchObject({ ready: true })
    expect(writes.map((w) => w.service)).toEqual(['be', 'ai'])
    expectNoValues(res)
  })

  it('a second send of the same service hands the new values to the writer again', async () => {
    await put(id(), send({ be: BE }))
    const res = await put(id(), send({ be: { ...BE, JWT_SECRET: 'new-jwt-secret' } }))
    expect(res.status).toBe(200)
    expect(writes.map((w) => w.values.JWT_SECRET)).toEqual([BE.JWT_SECRET, 'new-jwt-secret'])
    expectNoValues(res, [...ALL_VALUES, 'new-jwt-secret'])
  })

  it('stores a new digest when the value changes, so the hash changes', async () => {
    await put(id(), send({ be: BE, ai: AI }))
    const first = ((await get(id())).body as { secretHash: string }).secretHash
    await put(id(), send({ be: { ...BE, JWT_SECRET: 'changed' } }))
    const second = ((await get(id())).body as { secretHash: string }).secretHash
    expect(second).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(second).not.toBe(first)
  })

  it('does not call the writer or the database for a service that has no secret keys', async () => {
    const res = await put(id(), send({ fe: {} }))
    expect(res.status).toBe(200)
    expect(writes).toEqual([])
    expect(secretWrites).toEqual([])
  })

  it('does not trim a value: spaces and line breaks reach the writer as typed', async () => {
    await put(id(), send({ be: { ...BE, JWT_SECRET: '  keep me \n' } }))
    expect(writes[0].values.JWT_SECRET).toBe('  keep me \n')
  })

  describe('rejects with 400 INVALID_SECRETS, and touches neither the writer nor the database', () => {
    it.each([
      ['a missing key', send({ be: { DATABASE_URL: BE.DATABASE_URL } }), [{ path: 'secrets.be.JWT_SECRET', code: 'REQUIRED' }]],
      ['a blank value', send({ be: { ...BE, JWT_SECRET: '   ' } }), [{ path: 'secrets.be.JWT_SECRET', code: 'REQUIRED' }]],
      ['an unknown key', send({ be: { ...BE, EXTRA: 'x' } }), [{ path: 'secrets.be.EXTRA', code: 'UNKNOWN_KEY' }]],
      ['an unknown service', send({ nope: { A: 'x' } }), [{ path: 'secrets.nope', code: 'UNKNOWN_SERVICE' }]],
      ['no services', send({}), [{ path: 'secrets', code: 'REQUIRED' }]],
      ['no services field', {}, [{ path: 'secrets', code: 'REQUIRED' }]],
      ['a value that is not a string', send({ be: { ...BE, JWT_SECRET: 123 } }), [{ path: 'secrets.be.JWT_SECRET', code: 'INVALID_TYPE' }]],
    ])('%s', async (_, payload, fields) => {
      const res = await put(id(), payload)
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: { code: 'INVALID_SECRETS', message: expect.stringContaining('secrets') as string, fields } })
      expect(writes).toEqual([])
      expect(secretWrites).toEqual([])
      expectNoValues(res)
    })

    it('a half-filled service even if the other service is complete: nothing is written for either', async () => {
      const res = await put(id(), send({ be: BE, ai: {} }))
      expect(res.status).toBe(400)
      expect(writes).toEqual([])
    })
  })

  describe('body that is not a JSON object', () => {
    it.each([['a list', '[1]'], ['a string', '"x"'], ['null', 'null'], ['a number', '5']])('%s: 400 BAD_REQUEST', async (_, text) => {
      const res = await put(id(), text)
      expect(res.status).toBe(400)
      expect(res.body).toEqual(errorBody('BAD_REQUEST'))
      expect(writes).toEqual([])
    })

    // Node의 JSON 파서 오류 문구는 본문 조각을 담는 경우가 있다("Unexpected token ..., \"<본문 앞부분>\" is not valid JSON").
    it.each([
      ['a value without quotes', '{"services":{"be":{"JWT_SECRET": leaky-secret-value}}}'],
      ['a missing comma', '{"services":{"be":{"JWT_SECRET":"leaky-secret-value" "oops"}}}'],
      ['text that is not JSON at all', 'leaky-secret-value'],
    ])('malformed JSON that contains a secret (%s): 400, and the secret is in neither the response nor the logs', async (_, text) => {
      const res = await put(id(), text)
      expect(res.status).toBe(400)
      expect(JSON.stringify([res.text, logs.map((l) => l.mock.calls)])).not.toContain('leaky-secret-value')
    })

    it('a body over 100KB: 413 PAYLOAD_TOO_LARGE, and the logs have no value', async () => {
      const res = await put(id(), JSON.stringify(send({ be: { ...BE, JWT_SECRET: 'big-secret-' + 'x'.repeat(120_000) } })))
      expect(res.status).toBe(413)
      expect(res.body).toEqual(errorBody('PAYLOAD_TOO_LARGE'))
      expect(JSON.stringify([res.text, logs.map((l) => l.mock.calls)])).not.toContain('big-secret-')
    })
  })

  describe('who may call', () => {
    it('no token: 401, and nothing else is called', async () => {
      const res = await put(id(), send({ be: BE }), null)
      expect(res.status).toBe(401)
      expect(res.body).toEqual(errorBody('AUTH_REQUIRED'))
      expect(writes).toEqual([])
    })

    it.each([
      ['a deploy of someone else', () => bearer(OTHER_USER_ID), undefined],
      ['an id that is not a UUID', undefined, 'not-a-uuid'],
      ['an id nobody has', undefined, randomUUID()],
    ])('%s: 404 DEPLOY_NOT_FOUND and nothing is written', async (_, auth, other) => {
      const res = await put(other ?? id(), send({ be: BE }), auth ? await auth() : undefined)
      expect(res.status).toBe(404)
      expect(res.body).toEqual(errorBody('DEPLOY_NOT_FOUND'))
      expect(writes).toEqual([])
      expect(secretWrites).toEqual([])
    })
  })

  describe('when the writer or the database fails', () => {
    it('the writer fails: 503 CLUSTER_UNAVAILABLE, and the service is not in (it stays writing)', async () => {
      fail = unreachable
      const res = await put(id(), send({ be: BE }))
      expect(res.status).toBe(503)
      expect(res.body).toEqual(errorBody('CLUSTER_UNAVAILABLE'))
      expect(secretRows.map((r) => [r.service, r.status, r.digest])).toEqual([['be', 'writing', null]])
      expect(((await get(id())).body as { ready: boolean }).ready).toBe(false)
      expectNoValues(res)
    })

    it('a service that was in is no longer in when its new write fails', async () => {
      await put(id(), send({ be: BE, ai: AI }))
      fail = unreachable
      const res = await put(id(), send({ be: { ...BE, JWT_SECRET: 'new-value' } }))
      expect(res.status).toBe(503)
      const status = (await get(id())).body as { ready: boolean; services: { name: string; status: string }[] }
      expect(status.ready).toBe(false)
      expect(status.services.map((s) => [s.name, s.status])).toEqual([['be', 'missing'], ['ai', 'in']])
    })

    it('the first service is written and the second fails: 503, the first stays in and the second is not', async () => {
      fail = (service) => (service === 'ai' ? unreachable() : undefined)
      const res = await put(id(), send({ be: BE, ai: AI }))
      expect(res.status).toBe(503)
      const status = (await get(id())).body as { services: { name: string; status: string }[] }
      expect(status.services.map((x) => [x.name, x.status])).toEqual([['be', 'in'], ['ai', 'missing']])
      expectNoValues(res)
    })

    it('no SecretWriter is bound yet: 503 CLUSTER_UNAVAILABLE, nothing is in; GET still works', async () => {
      await app.close()
      app = await startApp()
      const res = await put(id(), send({ be: BE }))
      expect(res.status).toBe(503)
      expect(res.body).toEqual(errorBody('CLUSTER_UNAVAILABLE'))
      expect(secretRows.map((r) => r.status)).toEqual(['writing'])
      expect((await get(id())).status).toBe(200)
      expect(((await get(id())).body as { ready: boolean }).ready).toBe(false)
    })

    it('the database refuses the first record: 503 DATABASE_UNAVAILABLE and nothing is written', async () => {
      restFail.deploy_secrets = { POST: () => new Response('{}', { status: 500 }) }
      const res = await put(id(), send({ be: BE }))
      expect(res.status).toBe(503)
      expect(res.body).toEqual(errorBody('DATABASE_UNAVAILABLE'))
      expect(writes).toEqual([])
      expectNoValues(res)
    })

    it('the database refuses the record after the write: 503 DATABASE_UNAVAILABLE, the writer was called but the service is not in', async () => {
      let posts = 0
      restFail.deploy_secrets = { POST: () => (++posts === 2 ? new Response('{}', { status: 500 }) : undefined) }
      const res = await put(id(), send({ be: BE }))
      expect(res.status).toBe(503)
      expect(res.body).toEqual(errorBody('DATABASE_UNAVAILABLE'))
      expect(writes).toHaveLength(1)
      expect(secretRows.map((r) => [r.service, r.status])).toEqual([['be', 'writing']])
      expect(((await get(id())).body as { ready: boolean }).ready).toBe(false)
      expectNoValues(res)
    })
  })
})

describe('GET /api/deploys/:id/secrets', () => {
  it('nothing written yet: not ready, every key missing, and the writer is not called', async () => {
    const res = await get(id())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ready: false,
      secretHash: null,
      services: [
        { name: 'be', status: 'missing', keys: [{ key: 'DATABASE_URL', status: 'missing' }, { key: 'JWT_SECRET', status: 'missing' }] },
        { name: 'ai', status: 'missing', keys: [{ key: 'OPENAI_API_KEY', status: 'missing' }] },
      ],
    })
    expect(writes).toEqual([])
  })

  it('a deploy that needs no secret is ready at once, with no services and no hash', async () => {
    deploys = [deployRow({ spec: spec([svc('fe', [])]) })]
    expect((await get(id())).body).toEqual({ ready: true, secretHash: null, services: [] })
  })

  it('a later deploy of the same project with the same keys is in without sending again; changed keys are missing', async () => {
    await put(id(), send({ be: BE, ai: AI }))
    const same = deployRow()
    const changed = deployRow({ spec: spec([svc('fe', []), svc('be', ['DATABASE_URL', 'NEW_KEY']), svc('ai', ['OPENAI_API_KEY'])]) })
    deploys.push(same, changed)
    expect((await get(same.id)).body).toMatchObject({ ready: true })
    const res = (await get(changed.id)).body as { ready: boolean; services: { name: string; status: string }[] }
    expect(res.ready).toBe(false)
    expect(res.services.map((s) => [s.name, s.status])).toEqual([['be', 'missing'], ['ai', 'in']])
  })

  it('does not show the state of another project', async () => {
    secretRows.push({ slug: 'other-app', service: 'be', keys: ['DATABASE_URL', 'JWT_SECRET'], status: 'in', digest: serviceDigest(BE), updated_at: 'x' })
    expect(((await get(id())).body as { services: { status: string }[] }).services[0].status).toBe('missing')
  })

  it.each([
    ['no token', null, 401],
    ['a deploy of someone else', 'other', 404],
  ])('%s', async (_, who, code) => {
    const res = await get(id(), who === null ? null : await bearer(OTHER_USER_ID))
    expect(res.status).toBe(code)
  })

  it('an id that is not a UUID: 404 DEPLOY_NOT_FOUND', async () => {
    const res = await get('not-a-uuid')
    expect(res.status).toBe(404)
    expect(res.body).toEqual(errorBody('DEPLOY_NOT_FOUND'))
  })

  it.each([
    ['500', () => new Response('{}', { status: 500 })],
    ['not a list', () => Response.json({ not: 'a list' })],
    ['a row it cannot read', () => Response.json([{ service: 'be', keys: 'nope', status: 'in', digest: null }])],
  ])('the database answers %s: 503 DATABASE_UNAVAILABLE', async (_, answer) => {
    restFail.deploy_secrets = { GET: answer }
    const res = await get(id())
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('DATABASE_UNAVAILABLE'))
  })
})
