import { randomUUID } from 'node:crypto'
import { ConflictException, type INestApplication, Logger } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { AgentClient } from '../src/deploys/agent.client.js'
import { DeployConditionService } from '../src/deploys/deploy-condition.service.js'
import { DeployPreparer } from '../src/deploys/deploy-preparer.js'
import { ClusterError } from '../src/k8s/cluster-error.js'
import { ClusterReader } from '../src/k8s/cluster-reader.js'
import { DeploymentScaler } from '../src/k8s/deployment-scaler.js'
import { combineDigests, serviceDigest } from '../src/deploys/secrets-input.js'
import { errorBody, JWKS_URL, keySet, token } from './auth-helpers.js'
import { startApp } from './start-app.js'

// vitest.config.ts가 넣은 서버의 해시 키.
const HASH_KEY = process.env.SECRET_HASH_KEY ?? ''
const REST = 'https://test.supabase.co/rest/v1/'
const GOCD_URL = 'https://gocd.test/go/api/pipelines/student-deploy/schedule'
const AI_URL = 'https://ai.test/agent/tickets'
const CLOSE_URL = `${AI_URL}/t_stale/close`
const NOTIFY_TOKEN = 'pipeline_notify_test_0123456789abcdef'
const SHA = '0123456789abcdef0123456789abcdef01234567'
const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const IMAGE = `ghcr.io/woowang-bot/student-apps@sha256:${'c'.repeat(64)}`
const OLD_IMAGE = `ghcr.io/woowang-bot/student-apps@sha256:${'d'.repeat(64)}`
const FE_HASH = `sha256:${'a'.repeat(64)}`
const BE_HASH = `sha256:${'b'.repeat(64)}`
const SECRET_LINE = `DATABASE_URL=postgres://admin:hunter2pass@db.example.com/app token=ghp_${'a'.repeat(36)}`

type Row = Record<string, unknown>
let db: Record<string, Row[]>
// 가짜 GoCD · AI 서버의 답. 기본은 성공이다.
let gocdAnswer: () => Response
let aiAnswer: () => Response
// 저장소의 특정 테이블 · 메서드에 대신 돌려줄 답(없으면 가짜 DB가 답한다).
let restOverride: ((table: string, method: string) => Response | undefined) | undefined
// 가짜 준비 확인(#82). 기본은 준비됨이고 슬롯은 a다.
let prepare: (deployId: string) => Promise<unknown>
// 가짜 클러스터(W7): 공간의 Deployment 이름(또는 읽기 오류)과, 0으로 내린 것 · 내리지 못하는 것.
let spaceDeployments: string[] | Error
let scaled: { slug: string; name: string }[]
let scaleFails: Record<string, Error>
let app: INestApplication<App>
let logError: MockInstance<Logger['error']>

const urlOf = (i: string | URL | Request) => (i instanceof Request ? i.url : i.toString())
const conflict = (constraint: string) =>
  new Response(JSON.stringify({ code: '23505', message: `duplicate key value violates unique constraint "${constraint}"` }), { status: 409 })

const matches = (row: Row, params: URLSearchParams) => {
  for (const [k, v] of params) {
    if (['select', 'limit', 'order', 'on_conflict'].includes(k)) continue
    if (v.startsWith('eq.')) {
      if (String(row[k]) !== v.slice(3)) return false
    } else if (v.startsWith('in.(')) {
      if (!v.slice(4, -1).split(',').includes(String(row[k]))) return false
    } else throw new Error(`unexpected filter ${k}=${v}`)
  }
  return true
}

// PostgREST의 가짜: 필터(eq · in), order=created_at.desc, limit, upsert(on_conflict), deploy_runs의 유일성 제약.
function rest(url: URL, init: RequestInit | undefined): Response {
  const table = url.pathname.split('/').pop()!
  const rows = (db[table] ??= [])
  const method = init?.method ?? 'GET'
  const forced = restOverride?.(table, method)
  if (forced) return forced
  const body = init?.body ? (JSON.parse(init.body as string) as Row | Row[]) : undefined
  if (method === 'GET') {
    let out = rows.filter((r) => matches(r, url.searchParams))
    if (url.searchParams.get('order') === 'created_at.desc') out = [...out].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    return Response.json(out.slice(0, Number(url.searchParams.get('limit') ?? out.length)))
  }
  if (method === 'PATCH') {
    const hit = rows.filter((r) => matches(r, url.searchParams))
    for (const r of hit) Object.assign(r, body)
    return Response.json(hit)
  }
  if (method === 'DELETE') {
    const hit = rows.filter((r) => matches(r, url.searchParams))
    db[table] = rows.filter((r) => !hit.includes(r))
    return Response.json(hit)
  }
  const out: Row[] = []
  for (const input of Array.isArray(body) ? body : [body!]) {
    const onConflict = url.searchParams.get('on_conflict')
    if (onConflict) {
      const cols = onConflict.split(',')
      const existing = rows.find((r) => cols.every((c) => r[c] === input[c]))
      if (existing) {
        Object.assign(existing, input)
        out.push(existing)
        continue
      }
    }
    if (table === 'deploy_runs') {
      if (rows.some((r) => r.deploy_id === input.deploy_id)) return conflict('deploy_runs_pkey')
      if (rows.some((r) => r.slug === input.slug && ['running', 'fixing'].includes(r.status as string))) return conflict('deploy_runs_active_slug_idx')
      const now = new Date().toISOString()
      Object.assign(input, { failure: null, ticket_id: null, gateway_token_hash: null, gateway_expires_at: null, images: null, created_at: now, updated_at: now })
    }
    rows.push(input)
    out.push(input)
  }
  return Response.json(out, { status: 201 })
}

const fetchMock = vi.fn<typeof fetch>((input, init) => {
  const url = urlOf(input)
  if (url === JWKS_URL) return Promise.resolve(Response.json(keySet))
  if (url.startsWith(REST)) return Promise.resolve().then(() => rest(new URL(url), init))
  if (url === GOCD_URL) return Promise.resolve().then(() => gocdAnswer())
  if (url === AI_URL) return Promise.resolve().then(() => aiAnswer())
  if (url === CLOSE_URL) return Promise.resolve(new Response(null, { status: 204 }))
  return Promise.reject(new Error(`unexpected fetch ${url}`))
})
const callsTo = (url: string) => fetchMock.mock.calls.filter(([u]) => urlOf(u) === url)
interface Sent {
  ticket: { ticketId: string; stage: string; raw: unknown; logs: { lines: unknown[] }; deployInput: unknown }
  gateway: { token: string; expiresAt: string }
  [k: string]: unknown
}
// GoCD · AI 서버로 보낸 본문. 요청마다 모양이 달라 필요한 칸만 적는다.
const bodyOf = (call: Parameters<typeof fetch>) => JSON.parse(call[1]?.body as string) as Sent
interface StatusBody {
  status: string
  stage: string | null
  steps: { key: string; state: string }[]
  failure: { code: string; stage: string; service: string | null; message: string } | null
  url: string | null
}
const stateLetters = (b: StatusBody) => b.steps.map((s) => s.state[0]).join('')

let clock = 0
function seedDeploy(over: Row = {}): string {
  const id = randomUUID()
  // 나중에 만든 배포가 더 최근이다.
  const created_at = new Date(Date.UTC(2026, 10, 11, 1, 0, clock++)).toISOString()
  ;(db.deploys ??= []).push({ id, user_id: USER, slug: 'my-app', repo: 'Student/My-App', commit_sha: SHA, spec: {}, created_at, ...over })
  return id
}
const preparedFor = (deployId: string, slot = 'a') => ({
  deployId,
  slot,
  input: {
    commitSha: SHA,
    deploy_condition: {
      secretHash: null,
      services: {
        fe: { buildInputHash: FE_HASH, build: 'run', image: null },
        be: { buildInputHash: BE_HASH, build: 'reuse', image: OLD_IMAGE },
      },
    },
    spec: { project: { slug: 'my-app', repo: 'student/my-app' }, services: [{ name: 'be', runtime: { secretKeys: ['DATABASE_URL'], env: {} } }] },
  },
})

const bearer = async (sub = USER) => `Bearer ${await token({ sub })}`
const as = async (r: request.Test, auth?: string | null) => r.set(auth === null ? {} : { Authorization: auth ?? (await bearer()) })
const start = async (id: string, auth?: string | null) => as(request(app.getHttpServer()).post(`/api/deploys/${id}/start`), auth)
const status = async (id: string, auth?: string | null) => as(request(app.getHttpServer()).get(`/api/deploys/${id}/status`), auth)
const list = async (qs = '', auth?: string | null) => as(request(app.getHttpServer()).get(`/api/deploys${qs}`), auth)
const machine = (r: request.Test, t: string | null = NOTIFY_TOKEN) => (t === null ? r : r.set('Authorization', `Bearer ${t}`))
const notify = (body: unknown, t?: string | null) => machine(request(app.getHttpServer()).post('/api/pipeline/notify').send(body as object), t)
const pipelineInput = (id: string, t?: string | null) => machine(request(app.getHttpServer()).get(`/api/pipeline/deploys/${id}/input`), t)
const run = (id: string) => db.deploy_runs.find((r) => r.deploy_id === id)!

beforeEach(async () => {
  db = {}
  clock = 0
  gocdAnswer = () => new Response('{"message":"Request to schedule pipeline accepted"}', { status: 202 })
  aiAnswer = () => Response.json({ ticketId: 't_x' }, { status: 202 })
  prepare = (id) => Promise.resolve(preparedFor(id))
  restOverride = undefined
  spaceDeployments = []
  scaled = []
  scaleFails = {}
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  app = await startApp([], (b) =>
    b
      .overrideProvider(DeployPreparer)
      .useValue({ prepareIfReady: (id: string) => prepare(id) })
      .overrideProvider(ClusterReader)
      .useValue({ deployments: () => (spaceDeployments instanceof Error ? Promise.reject(spaceDeployments) : Promise.resolve(spaceDeployments.map((name) => ({ name })))) })
      .overrideProvider(DeploymentScaler)
      .useValue({
        scaleToZero: (slug: string, name: string) => {
          if (scaleFails[name]) return Promise.reject(scaleFails[name])
          scaled.push({ slug, name })
          return Promise.resolve()
        },
      }),
  )
})

afterEach(async () => {
  await app.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('POST /api/deploys/:id/start', () => {
  it('records a run for the prepared slot and starts the pipeline with only the deploy id', async () => {
    const id = seedDeploy()
    const res = await start(id)
    expect(res.status).toBe(202)
    expect(res.body).toEqual({ deployId: id, status: 'running', stage: 'build', targetSlot: 'a' })
    expect(run(id)).toMatchObject({ user_id: USER, slug: 'my-app', target_slot: 'a', status: 'running', stage: 'build' })

    const calls = callsTo(GOCD_URL)
    expect(calls).toHaveLength(1)
    expect(calls[0][1]?.headers).toEqual({
      Accept: 'application/vnd.go.cd.v1+json',
      'Content-Type': 'application/json',
      'X-GoCD-Confirm': 'true',
      Authorization: 'Bearer gocd_token_test',
    })
    expect(bodyOf(calls[0])).toEqual({ environment_variables: [{ name: 'DEPLOY_ID', value: id }], update_materials_before_scheduling: true })
  })

  it('does not reveal another user\'s deploy, a missing one, or a malformed id (all 404, nothing started)', async () => {
    const mine = seedDeploy({ user_id: OTHER })
    for (const id of [mine, randomUUID(), 'not-a-uuid']) {
      const res = await start(id)
      expect(res.status).toBe(404)
      expect(res.body).toEqual(errorBody('DEPLOY_NOT_FOUND'))
    }
    expect(db.deploy_runs ?? []).toEqual([])
    expect(callsTo(GOCD_URL)).toHaveLength(0)
  })

  it('accepts the empty JSON body the FE sends', async () => {
    const id = seedDeploy()
    const res = await request(app.getHttpServer())
      .post(`/api/deploys/${id}/start`)
      .set({ Authorization: await bearer(), 'Content-Type': 'application/json' })
      .send({})
    expect(res.status).toBe(202)
  })

  it('needs a login', async () => {
    const res = await start(seedDeploy(), null)
    expect(res.status).toBe(401)
    expect(callsTo(GOCD_URL)).toHaveLength(0)
  })

  it('passes NOT_READY through and starts nothing', async () => {
    prepare = () => Promise.reject(new ConflictException({ code: 'NOT_READY', message: 'Secrets are missing' }))
    const id = seedDeploy()
    const res = await start(id)
    expect(res.status).toBe(409)
    expect(res.body).toEqual(errorBody('NOT_READY'))
    expect(db.deploy_runs ?? []).toEqual([])
    expect(callsTo(GOCD_URL)).toHaveLength(0)
  })

  it('refuses to start the same deploy twice', async () => {
    const id = seedDeploy()
    await start(id)
    const again = await start(id)
    expect(again.status).toBe(409)
    expect(again.body).toEqual(errorBody('ALREADY_STARTED'))
    expect(callsTo(GOCD_URL)).toHaveLength(1)
  })

  it('refuses while another deploy of the same project is running or being fixed, but not for another project', async () => {
    const first = seedDeploy()
    await start(first)
    const second = await start(seedDeploy())
    expect(second.status).toBe(409)
    expect(second.body).toEqual(errorBody('DEPLOY_IN_PROGRESS'))

    run(first).status = 'fixing'
    expect((await start(seedDeploy())).body).toEqual(errorBody('DEPLOY_IN_PROGRESS'))

    expect((await start(seedDeploy({ slug: 'other-app' }))).status).toBe(202)
    expect(callsTo(GOCD_URL)).toHaveLength(2)
  })

  it.each(['running', 'fixing'] as const)('frees the project when its %s run has not changed for over an hour (it ends as TIMED_OUT)', async (state) => {
    const first = seedDeploy()
    await start(first)
    run(first).status = state
    if (state === 'fixing') run(first).ticket_id = 't_stale'
    run(first).updated_at = new Date(Date.now() - 61 * 60_000).toISOString()
    const res = await start(seedDeploy())
    expect(res.status).toBe(202)
    expect(run(first)).toMatchObject({ status: 'failed', failure: { code: 'TIMED_OUT', stage: 'build', service: null } })
    expect(callsTo(GOCD_URL)).toHaveLength(2)
    // 고치던 실행이면 AI 서버에 티켓이 끝났다고 알린다(stopped).
    const closes = callsTo(CLOSE_URL)
    expect(closes).toHaveLength(state === 'fixing' ? 1 : 0)
    if (state === 'fixing') expect(bodyOf(closes[0])).toEqual({ ticketId: 't_stale', commitSha: SHA, reason: 'stopped' })
    expect(((await status(first)).body as StatusBody).failure?.code).toBe('TIMED_OUT')
  })

  it('does not free the project for a run that changed within the hour', async () => {
    const first = seedDeploy()
    await start(first)
    run(first).updated_at = new Date(Date.now() - 59 * 60_000).toISOString()
    expect((await start(seedDeploy())).body).toEqual(errorBody('DEPLOY_IN_PROGRESS'))
    expect(run(first).status).toBe('running')
  })

  it('logs a failed clean-up instead of swallowing it when GoCD refuses and the run cannot be deleted', async () => {
    const id = seedDeploy()
    gocdAnswer = () => new Response('{}', { status: 500 })
    restOverride = (table, method) => (table === 'deploy_runs' && method === 'DELETE' ? new Response('{}', { status: 500 }) : undefined)
    const res = await start(id)
    expect(res.body).toEqual(errorBody('PIPELINE_UNAVAILABLE'))
    expect(logError).toHaveBeenCalledWith(expect.any(Error))
  })

  it('allows a new deploy once the project\'s last one has ended', async () => {
    const first = seedDeploy()
    await start(first)
    run(first).status = 'failed'
    expect((await start(seedDeploy())).status).toBe(202)
  })

  it.each([
    ['a network error', () => { throw new TypeError('fetch failed') }],
    ['a timeout', () => { throw new DOMException('timed out', 'TimeoutError') }],
    ['a 401 (the token was refused)', () => new Response('{}', { status: 401 })],
    ['a 500', () => new Response('{}', { status: 500 })],
  ])('answers 503 and leaves no run behind when GoCD gives %s, so the same request can be retried', async (_n, answer) => {
    const id = seedDeploy()
    gocdAnswer = answer
    const res = await start(id)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('PIPELINE_UNAVAILABLE'))
    expect(db.deploy_runs).toEqual([])

    gocdAnswer = () => new Response('{}', { status: 202 })
    expect((await start(id)).status).toBe(202)
  })

  it('answers 503 DATABASE_UNAVAILABLE when the run cannot be stored', async () => {
    const id = seedDeploy()
    restOverride = (table, method) => (table === 'deploy_runs' && method === 'POST' ? new Response('{}', { status: 500 }) : undefined)
    const res = await start(id)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('DATABASE_UNAVAILABLE'))
    expect(callsTo(GOCD_URL)).toHaveLength(0)
  })
})

// DeploysModule의 묶음 그대로: 시작이 부르는 DeployPreparer가 실제 DeployReadinessService(#82)다.
describe('POST /api/deploys/:id/start with the real readiness check', () => {
  const BE = { DATABASE_URL: 'postgres://u:p@h/db', JWT_SECRET: 'jwt-secret-value' }
  const specWith = (secretKeys: string[]) => ({ project: { slug: 'my-app' }, services: [{ name: 'be', runtime: { secretKeys, env: {} } }] })
  const secretRow = (over: Row = {}) => ({ slug: 'my-app', service: 'be', keys: ['DATABASE_URL', 'JWT_SECRET'], status: 'in', digest: serviceDigest(BE, HASH_KEY), ...over })

  // DeployPreparer는 그대로 두고(실제 DeployReadinessService) 그 아래의 DeployConditionService.prepare만 가짜로 둔다.
  let preparedWith: (string | null)[]
  beforeEach(async () => {
    await app.close()
    preparedWith = []
    app = await startApp([], (b) =>
      b.overrideProvider(DeployConditionService).useValue({
        prepare: (id: string, secretHash: string | null) => {
          preparedWith.push(secretHash)
          return prepare(id)
        },
      }),
    )
  })

  it('answers 409 NOT_READY with the missing keys and starts nothing', async () => {
    const id = seedDeploy({ spec: specWith(['DATABASE_URL', 'JWT_SECRET']) })
    const res = await start(id)
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({
      error: {
        code: 'NOT_READY',
        fields: [
          { path: 'secrets.be.DATABASE_URL', code: 'REQUIRED' },
          { path: 'secrets.be.JWT_SECRET', code: 'REQUIRED' },
        ],
      },
    })
    expect(preparedWith).toEqual([])
    expect(db.deploy_runs ?? []).toEqual([])
    expect(callsTo(GOCD_URL)).toHaveLength(0)
  })

  it('does not count a half-written Secret as ready', async () => {
    ;(db.deploy_secrets ??= []).push(secretRow({ status: 'writing', digest: null }))
    const res = await start(seedDeploy({ spec: specWith(['DATABASE_URL', 'JWT_SECRET']) }))
    expect(res.status).toBe(409)
    expect(callsTo(GOCD_URL)).toHaveLength(0)
  })

  it('starts once every key is in and hands the combined secret hash to the condition', async () => {
    ;(db.deploy_secrets ??= []).push(secretRow())
    const id = seedDeploy({ spec: specWith(['DATABASE_URL', 'JWT_SECRET']) })
    const res = await start(id)
    expect(res.status).toBe(202)
    expect(preparedWith).toEqual([combineDigests([{ name: 'be', digest: serviceDigest(BE, HASH_KEY) }], HASH_KEY)])
    expect(callsTo(GOCD_URL)).toHaveLength(1)
  })

  it('starts without any secret when the spec has no secret keys (hash is null)', async () => {
    const res = await start(seedDeploy({ spec: specWith([]) }))
    expect(res.status).toBe(202)
    expect(preparedWith).toEqual([null])
  })

  it('still hides another user\'s deploy before the readiness check runs', async () => {
    const res = await start(seedDeploy({ user_id: OTHER, spec: specWith(['DATABASE_URL']) }))
    expect(res.status).toBe(404)
    expect(preparedWith).toEqual([])
  })
})

describe('GET /api/deploys/:id/status', () => {
  it('shows a saved deploy that was not started as waiting at the secrets step', async () => {
    const id = seedDeploy()
    const res = await status(id)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      deployId: id,
      status: 'not_started',
      stage: null,
      steps: [
        { key: 'intake', state: 'done' },
        { key: 'analysis', state: 'done' },
        { key: 'config', state: 'done' },
        { key: 'secrets', state: 'active' },
        { key: 'build', state: 'pending' },
        { key: 'deploy', state: 'pending' },
        { key: 'verify', state: 'pending' },
        { key: 'done', state: 'pending' },
      ],
      failure: null,
      agent: null,
      url: null,
      warnings: [],
      updatedAt: '2026-11-11T01:00:00.000Z',
    })
  })

  it('shows the AI agent result the gateway stored, and only its student-facing fields', async () => {
    const id = seedDeploy()
    await start(id)
    Object.assign(run(id), {
      status: 'needs_user',
      agent_result: {
        status: 'needs_user',
        summary: 'DATABASE_URL이 비어 있어 서버가 뜨지 않습니다.',
        userRequest: { message: 'DATABASE_URL을 다시 넣어 주세요.', secretKeys: ['DATABASE_URL'] },
        pr: null,
        evidence: [{ ref: 'pod-logs', text: 'Error: DATABASE_URL is not set' }, { text: 'no ref' }],
        classification: { method: 'code', caseId: 'A3', path: 'playbook' },
      },
    })
    const { agent } = (await status(id)).body as { agent: unknown }
    expect(agent).toEqual({
      status: 'needs_user',
      summary: 'DATABASE_URL이 비어 있어 서버가 뜨지 않습니다.',
      userRequest: { message: 'DATABASE_URL을 다시 넣어 주세요.', secretKeys: ['DATABASE_URL'] },
      prUrl: null,
      evidence: [
        { ref: 'pod-logs', text: 'Error: DATABASE_URL is not set' },
        { ref: null, text: 'no ref' },
      ],
    })

    run(id).agent_result = { status: 'pr_opened', summary: 'PR을 열었습니다.', pr: { url: 'https://github.com/student/app/pull/3' } }
    expect(((await status(id)).body as { agent: unknown }).agent).toEqual({
      status: 'pr_opened',
      summary: 'PR을 열었습니다.',
      userRequest: null,
      prUrl: 'https://github.com/student/app/pull/3',
      evidence: [],
    })
  })

  it('follows a run through the stages', async () => {
    const id = seedDeploy()
    await start(id)
    let body = (await status(id)).body as StatusBody
    expect(body).toMatchObject({ status: 'running', stage: 'build', failure: null, url: null })
    expect(stateLetters(body)).toBe('ddddappp')

    run(id).stage = 'apply'
    body = (await status(id)).body as StatusBody
    expect(stateLetters(body)).toBe('dddddapp')
  })

  it('hides another user\'s deploy exactly like a missing one', async () => {
    const id = seedDeploy({ user_id: OTHER })
    db.deploy_runs = [{ deploy_id: id, user_id: OTHER, slug: 'my-app', status: 'running', stage: 'build', target_slot: 'a', input: {}, created_at: 'x', updated_at: '2026-11-11T01:00:00Z' }]
    const theirs = await status(id)
    const missing = await status(randomUUID())
    const malformed = await status('nope')
    for (const res of [theirs, missing, malformed]) {
      expect(res.status).toBe(404)
      expect(res.body).toEqual(errorBody('DEPLOY_NOT_FOUND'))
    }
  })

  it('needs a login', async () => {
    expect((await status(seedDeploy(), null)).status).toBe(401)
  })

  it('gives the public address only once the run succeeded', async () => {
    const id = seedDeploy()
    await start(id)
    run(id).status = 'succeeded'
    run(id).stage = null
    const body = (await status(id)).body as StatusBody
    expect(body.url).toBe('https://my-app.stairnoworks.com')
    expect(stateLetters(body)).toBe('dddddddd')
  })

  it('answers 503 when the database cannot be reached', async () => {
    const id = seedDeploy()
    restOverride = (table) => {
      if (table === 'deploy_runs') throw new TypeError('fetch failed')
      return undefined
    }
    const res = await status(id)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('DATABASE_UNAVAILABLE'))
  })
})

describe('GET /api/deploys', () => {
  it('lists only my deploys, newest first, with their status', async () => {
    const older = seedDeploy({ slug: 'old-app' })
    seedDeploy({ user_id: OTHER, slug: 'their-app' })
    const newer = seedDeploy()
    await start(newer)
    const res = await list()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      deploys: [
        { id: newer, repo: 'Student/My-App', slug: 'my-app', commit: SHA, createdAt: expect.any(String) as string, status: 'running', stage: 'build', url: null },
        { id: older, repo: 'Student/My-App', slug: 'old-app', commit: SHA, createdAt: expect.any(String) as string, status: 'not_started', stage: null, url: null },
      ],
    })
  })

  it('is empty for a user with no deploys', async () => {
    expect((await list()).body).toEqual({ deploys: [] })
  })

  it('applies limit, and rejects one that is not 1 to 50', async () => {
    for (let i = 0; i < 3; i++) seedDeploy()
    expect(((await list('?limit=2')).body as { deploys: unknown[] }).deploys).toHaveLength(2)
    for (const bad of ['0', '51', 'abc', '-1', '1.5', '']) {
      const res = await list(`?limit=${bad}`)
      expect(res.status).toBe(400)
      expect(res.body).toEqual(errorBody('INVALID_LIMIT'))
    }
  })

  it('needs a login', async () => {
    expect((await list('', null)).status).toBe(401)
  })
})

describe('machine routes (/api/pipeline/*)', () => {
  it('refuse a missing, wrong, or user token', async () => {
    const id = seedDeploy()
    await start(id)
    for (const t of [null, 'wrong', await token({ sub: USER })]) {
      expect((await pipelineInput(id, t)).status).toBe(401)
      expect((await notify({ deployId: id, stage: 'build', result: 'passed', images: { fe: IMAGE } }, t)).status).toBe(401)
    }
    expect(run(id).stage).toBe('build')
  })

  it('a machine token is not a login token', async () => {
    const res = await request(app.getHttpServer()).get('/api/me').set('Authorization', `Bearer ${NOTIFY_TOKEN}`)
    expect(res.status).toBe(401)
  })

  it('hand the pipeline the input made at start, without secret values', async () => {
    const id = seedDeploy()
    await start(id)
    const res = await pipelineInput(id)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ deployId: id, slot: 'a', input: preparedFor(id).input })
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|ghp_/)
  })

  it('answer 404 for a deploy that was not started or an id that is not a UUID', async () => {
    const id = seedDeploy()
    expect((await pipelineInput(id)).status).toBe(404)
    expect((await pipelineInput('nope')).status).toBe(404)
    expect((await notify({ deployId: id, stage: 'build', result: 'passed', images: { fe: IMAGE } })).status).toBe(404)
  })
})

describe('POST /api/pipeline/notify', () => {
  it('moves a run forward one stage at a time and keeps the built images', async () => {
    const id = seedDeploy()
    await start(id)
    expect((await notify({ deployId: id, stage: 'build', result: 'passed', images: { fe: IMAGE } })).body).toEqual({ ok: true, applied: true })
    expect(run(id)).toMatchObject({ stage: 'prepare', status: 'running', images: { fe: IMAGE } })
    for (const [stage, next] of [['prepare', 'render'], ['render', 'apply'], ['apply', 'verify'], ['verify', 'switch']]) {
      await notify({ deployId: id, stage, result: 'passed' })
      expect(run(id).stage).toBe(next)
    }
  })

  it('rejects a bad body with the fields to fix, and a build without the images it must report', async () => {
    const id = seedDeploy()
    await start(id)
    const bad = await notify({ deployId: id, stage: 'deploy', result: 'passed' })
    expect(bad.status).toBe(400)
    expect(bad.body).toMatchObject({ error: { code: 'BAD_REQUEST', fields: [{ path: 'stage', code: 'INVALID_VALUE' }] } })

    for (const images of [{}, { fe: IMAGE, be: IMAGE }]) {
      const res = await notify({ deployId: id, stage: 'build', result: 'passed', images })
      expect(res.status).toBe(400)
    }
    expect(run(id).stage).toBe('build')
  })

  it('ignores a notice for a stage that is not the current one, and answers it the same way every time', async () => {
    const id = seedDeploy()
    await start(id)
    const stale = await notify({ deployId: id, stage: 'apply', result: 'passed' })
    expect(stale.body).toEqual({ ok: true, applied: false })
    expect(run(id).stage).toBe('build')

    await notify({ deployId: id, stage: 'build', result: 'passed', images: { fe: IMAGE } })
    const resend = await notify({ deployId: id, stage: 'build', result: 'passed', images: { fe: IMAGE } })
    expect(resend.body).toEqual({ ok: true, applied: false })
    expect(run(id).stage).toBe('prepare')
  })

  it('completes after switch: caches the new image, sets the live slot, and shows the address', async () => {
    const id = seedDeploy()
    await start(id)
    await notify({ deployId: id, stage: 'build', result: 'passed', images: { fe: IMAGE } })
    for (const stage of ['prepare', 'render', 'apply', 'verify']) await notify({ deployId: id, stage, result: 'passed' })
    expect(db.projects ?? []).toEqual([])
    expect((await notify({ deployId: id, stage: 'switch', result: 'passed' })).body).toEqual({ ok: true, applied: true })

    expect(db.projects).toEqual([expect.objectContaining({ slug: 'my-app', live_slot: 'a' })])
    // reuse한 be는 이미 캐시에 있으므로 새로 빌드한 fe만 적는다.
    expect(db.build_cache).toEqual([{ slug: 'my-app', service: 'fe', build_input_hash: FE_HASH, image: IMAGE }])
    expect(run(id)).toMatchObject({ status: 'succeeded', stage: null })
    expect((await status(id)).body).toMatchObject({ status: 'succeeded', url: 'https://my-app.stairnoworks.com' })

    // 같은 알림을 다시 받아도 아무것도 바뀌지 않는다.
    const resend = await notify({ deployId: id, stage: 'switch', result: 'passed' })
    expect(resend.body).toEqual({ ok: true, applied: false })
    expect(db.build_cache).toHaveLength(1)
  })

  describe('W7: the old live slot is scaled down after the address switched', () => {
    // 프로젝트는 슬롯 a가 live이고, 이번 배포는 b에 했다.
    const deployToB = async () => {
      ;(db.projects ??= []).push({ slug: 'my-app', live_slot: 'a' })
      prepare = (id) => Promise.resolve(preparedFor(id, 'b'))
      const id = seedDeploy()
      await start(id)
      await notify({ deployId: id, stage: 'build', result: 'passed', images: { fe: IMAGE } })
      for (const stage of ['prepare', 'render', 'apply', 'verify']) await notify({ deployId: id, stage, result: 'passed' })
      return id
    }
    const names = () => scaled.map((s) => s.name).sort()
    // 이름이 `-a`로 끝나는 것만 슬롯 a다(`banana`는 a로 끝나지만 슬롯이 아니다).
    const both = ['fe-a', 'be-a', 'fe-b', 'be-b', 'banana', 'a']

    it('scales only the Deployments of the old slot to 0, after the live slot changed', async () => {
      spaceDeployments = both
      const id = await deployToB()
      expect(scaled).toEqual([])
      await notify({ deployId: id, stage: 'switch', result: 'passed' })
      expect(names()).toEqual(['be-a', 'fe-a'])
      expect(scaled.every((s) => s.slug === 'my-app')).toBe(true)
      expect(db.projects).toEqual([expect.objectContaining({ slug: 'my-app', live_slot: 'b' })])
      expect(run(id)).toMatchObject({ status: 'succeeded', stage: null })
    })

    it('scales down the other slot even when the live slot was already switched by an earlier attempt', async () => {
      spaceDeployments = both
      const id = await deployToB()
      db.projects[0].live_slot = 'b'
      await notify({ deployId: id, stage: 'switch', result: 'passed' })
      expect(names()).toEqual(['be-a', 'fe-a'])
    })

    it('does nothing to the cluster on the first deploy of a project', async () => {
      spaceDeployments = both
      const id = seedDeploy()
      await start(id)
      await notify({ deployId: id, stage: 'build', result: 'passed', images: { fe: IMAGE } })
      for (const stage of ['prepare', 'render', 'apply', 'verify', 'switch']) await notify({ deployId: id, stage, result: 'passed' })
      expect(scaled).toEqual([])
      expect(run(id)).toMatchObject({ status: 'succeeded' })
    })

    it('still succeeds when some Deployments cannot be scaled down, and logs which', async () => {
      spaceDeployments = both
      scaleFails['be-a'] = new ClusterError('forbidden', 403)
      const id = await deployToB()
      expect((await notify({ deployId: id, stage: 'switch', result: 'passed' })).body).toEqual({ ok: true, applied: true })
      expect(names()).toEqual(['fe-a'])
      expect(run(id)).toMatchObject({ status: 'succeeded', stage: null })
      expect(db.projects).toEqual([expect.objectContaining({ live_slot: 'b' })])
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('W7: could not scale my-app be-a to 0'))
    })

    it('still succeeds when the Deployments cannot be listed', async () => {
      spaceDeployments = new ClusterError('unreachable')
      const id = await deployToB()
      expect((await notify({ deployId: id, stage: 'switch', result: 'passed' })).body).toEqual({ ok: true, applied: true })
      expect(scaled).toEqual([])
      expect(run(id)).toMatchObject({ status: 'succeeded' })
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('W7: could not list deployments of my-app'))
    })

    it('does not scale again when the same notice is sent twice', async () => {
      spaceDeployments = both
      const id = await deployToB()
      await notify({ deployId: id, stage: 'switch', result: 'passed' })
      await notify({ deployId: id, stage: 'switch', result: 'passed' })
      expect(names()).toEqual(['be-a', 'fe-a'])
    })
  })

  it('the next deploy of the project can start after it completed', async () => {
    const id = seedDeploy()
    await start(id)
    await notify({ deployId: id, stage: 'build', result: 'passed', images: { fe: IMAGE } })
    for (const stage of ['prepare', 'render', 'apply', 'verify', 'switch']) await notify({ deployId: id, stage, result: 'passed' })
    expect((await start(seedDeploy())).status).toBe(202)
  })

  describe('a failure', () => {
    const failure = (over: Record<string, unknown> = {}) => ({
      service: 'be',
      message: `deployment "be-b" exceeded its progress deadline ${SECRET_LINE}`,
      raw: { codebuild: null, k8s: { pod: { spec: { containers: [{ env: [{ name: 'DB_PASSWORD', value: 'hunter2pass' }] }] } }, events: [], status: null } },
      logs: { from: '2026-11-11T01:00:00Z', to: '2026-11-11T01:10:00Z', lines: [`boot ${SECRET_LINE}`] },
      ...over,
    })
    const reach = async (stage: string) => {
      const id = seedDeploy()
      await start(id)
      await notify({ deployId: id, stage: 'build', result: 'passed', images: { fe: IMAGE } })
      const order = ['prepare', 'render', 'apply', 'verify', 'switch']
      for (const s of order.slice(0, order.indexOf(stage))) await notify({ deployId: id, stage: s, result: 'passed' })
      return id
    }

    it.each([
      ['CODEBUILD_API_ERROR', 'build'],
      ['IMAGE_PULL_FAILED', 'apply'],
      ['LIVE_SLOT_PROTECTED', 'prepare'],
      ['CHART_RENDER_FAILED', 'render'],
      ['K8S_UNREACHABLE', 'apply'],
      ['AccountLimitExceededException', 'build'],
      ['constructor', 'apply'],
    ])('a platform problem (%s) ends as failed and does not call the AI server', async (code, stage) => {
      const id = stage === 'build' ? seedDeploy() : await reach(stage)
      if (stage === 'build') await start(id)
      const res = await notify({ deployId: id, stage, result: 'failed', failure: failure({ code }) })
      expect(res.body).toEqual({ ok: true, applied: true })
      expect(run(id)).toMatchObject({ status: 'failed', stage, failure: { code, stage, service: 'be' }, ticket_id: null })
      expect(callsTo(AI_URL)).toHaveLength(0)
      // 진행 중이 아니므로 같은 프로젝트의 다음 배포를 받는다.
      expect((await start(seedDeploy())).status).toBe(202)
    })

    it('a switch failure ends as failed (the ticket contract has no such stage) and does not call the AI server', async () => {
      const id = await reach('switch')
      await notify({ deployId: id, stage: 'switch', result: 'failed', failure: failure() })
      expect(run(id)).toMatchObject({ status: 'failed', stage: 'switch', failure: { code: 'SWITCH_FAILED' } })
      expect(callsTo(AI_URL)).toHaveLength(0)
    })


    it('a build failure sends one ticket to the AI server and the run waits as "fixing"', async () => {
      const id = seedDeploy()
      await start(id)
      const res = await notify({
        deployId: id,
        stage: 'build',
        result: 'failed',
        failure: { service: 'fe', message: 'npm ERR! build failed', raw: { codebuild: { id: 'cb:1', buildStatus: 'FAILED' } }, logs: { from: '2026-11-11T01:00:00Z', to: '2026-11-11T01:10:00Z', lines: ['x'] } },
      })
      expect(res.body).toEqual({ ok: true, applied: true })

      const [call] = callsTo(AI_URL)
      expect(call[1]?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer agent_token_test' })
      const sent = bodyOf(call)
      expect(sent.ticket).toMatchObject({
        ticketId: expect.stringMatching(/^t_[0-9a-f]{12}$/) as string,
        commitSha: SHA,
        stage: 'build',
        service: 'fe',
        targetSlot: 'a',
        errorMessage: 'npm ERR! build failed',
        raw: { codebuild: { id: 'cb:1', buildStatus: 'FAILED' }, k8s: null },
        logs: { lines: ['x'] },
        previous: null,
      })
      expect(sent.ticket.deployInput).toEqual(preparedFor(id).input)
      expect(sent.gateway.token).toMatch(/^gw_/)
      expect(Date.parse(sent.gateway.expiresAt)).toBeGreaterThan(Date.now())

      expect(run(id)).toMatchObject({ status: 'fixing', stage: 'build', ticket_id: sent.ticket.ticketId, failure: { code: 'BUILD_FAILED', service: 'fe' } })
      // 게이트웨이 토큰은 해시만 남는다.
      expect(JSON.stringify(run(id))).not.toContain(sent.gateway.token)
      expect(run(id).gateway_token_hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it.each(['apply', 'verify'])('puts a %s failure in the k8s shape, defaulting what the pipeline left out', async (stage) => {
      const id = await reach(stage)
      await notify({ deployId: id, stage, result: 'failed', failure: { service: 'be', message: 'm', raw: { k8s: { events: [{ reason: 'BackOff' }] } } } })
      const { ticket } = bodyOf(callsTo(AI_URL)[0])
      expect(ticket.stage).toBe(stage)
      expect(run(id)).toMatchObject({ status: 'fixing', ticket_id: ticket.ticketId })
      expect(ticket.raw).toEqual({ codebuild: null, k8s: { pod: null, events: [{ reason: 'BackOff' }], status: null } })
      expect(ticket.logs.lines).toEqual([])
    })

    it('keeps the secret key names in the ticket\'s deploy input (names, not values)', async () => {
      const id = await reach('apply')
      await notify({ deployId: id, stage: 'apply', result: 'failed', failure: failure() })
      const { ticket } = bodyOf(callsTo(AI_URL)[0])
      expect(JSON.stringify(ticket.deployInput)).toContain('"secretKeys":["DATABASE_URL"]')
    })

    it('answers 400 and leaves the run alone when the evidence does not fit the ticket shape, so the sender can see it', async () => {
      const id = await reach('render')
      const res = await notify({ deployId: id, stage: 'render', result: 'failed', failure: failure() }) // render needs raw.k8s.status
      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ error: { code: 'BAD_REQUEST', fields: [{ path: 'failure.raw.k8s.status', code: 'REQUIRED' }] } })
      expect(run(id)).toMatchObject({ status: 'running', stage: 'render', ticket_id: null })
      expect(callsTo(AI_URL)).toHaveLength(0)
    })

    it('masks secret-looking strings in everything that leaves the server, and in the answers', async () => {
      const id = await reach('apply')
      await notify({ deployId: id, stage: 'apply', result: 'failed', failure: failure() })
      const sentText = JSON.stringify(callsTo(AI_URL).map(bodyOf))
      for (const secret of ['hunter2pass', `ghp_${'a'.repeat(36)}`]) {
        expect(sentText).not.toContain(secret)
        expect(JSON.stringify((await status(id)).body)).not.toContain(secret)
        expect(JSON.stringify(db.deploy_runs)).not.toContain(secret)
        expect(JSON.stringify(fetchMock.mock.calls.filter(([u]) => urlOf(u) !== AI_URL))).not.toContain(secret)
      }
      expect(sentText).toContain('[REDACTED]')
    })

    it('shows the student a fixed sentence, never the raw message or logs', async () => {
      const id = await reach('apply')
      await notify({ deployId: id, stage: 'apply', result: 'failed', failure: failure() })
      const body = (await status(id)).body as StatusBody
      expect(body).toMatchObject({ status: 'fixing', stage: 'apply', failure: { code: 'DEPLOY_FAILED', stage: 'apply', service: 'be' } })
      expect(Object.keys(body.failure!).sort()).toEqual(['code', 'message', 'service', 'stage'])
      expect(body.failure!.message).not.toMatch(/progress deadline|DATABASE_URL/)
      expect(body.steps.find((s) => s.key === 'deploy')?.state).toBe('active')
    })

    it('sends the ticket once even if the same failure notice arrives twice', async () => {
      const id = await reach('apply')
      const n = { deployId: id, stage: 'apply', result: 'failed', failure: failure() }
      await Promise.all([notify(n), notify(n)])
      expect(callsTo(AI_URL)).toHaveLength(1)
    })

    it.each([
      ['a network error', () => { throw new TypeError('fetch failed') }],
      ['a 503 AGENT_BUSY', () => new Response('{}', { status: 503 })],
      ['a 401', () => new Response('{}', { status: 401 })],
      ['an answer that is not 202', () => new Response('{}', { status: 200 })],
    ])('ends as failed with AGENT_UNAVAILABLE when the AI server gives %s', async (_n, answer) => {
      aiAnswer = answer
      const id = await reach('apply')
      const res = await notify({ deployId: id, stage: 'apply', result: 'failed', failure: failure() })
      expect(res.status).toBe(200)
      expect(run(id)).toMatchObject({ status: 'failed', failure: { code: 'AGENT_UNAVAILABLE', stage: 'apply' } })
      expect((await start(seedDeploy())).status).toBe(202)
    })

    it('ends as failed instead of staying "fixing" when building or sending the ticket throws', async () => {
      vi.spyOn(AgentClient.prototype, 'sendTicket').mockRejectedValue(new Error('boom'))
      const id = await reach('apply')
      expect((await notify({ deployId: id, stage: 'apply', result: 'failed', failure: failure() })).status).toBe(200)
      expect(run(id)).toMatchObject({ status: 'failed', failure: { code: 'AGENT_UNAVAILABLE' } })
    })

    it('ignores a failure for a run that already ended', async () => {
      const id = await reach('apply')
      await notify({ deployId: id, stage: 'apply', result: 'failed', failure: failure({ code: 'IMAGE_PULL_FAILED' }) })
      const again = await notify({ deployId: id, stage: 'apply', result: 'failed', failure: failure() })
      expect(again.body).toEqual({ ok: true, applied: false })
      expect(callsTo(AI_URL)).toHaveLength(0)
    })
  })
})
