// 설명 플래그를 켠 채로 앱을 띄운다. ConfigModule이 import될 때 env를 읽으므로 import보다 먼저 넣는다.
vi.hoisted(() => {
  process.env.DEPLOY_EXPLAIN_ENABLED = 'true'
})

import { randomUUID } from 'node:crypto'
import { type INestApplication, Logger } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeployPreparer } from '../src/deploys/deploy-preparer.js'
import { ClusterCapacity } from '../src/k8s/cluster-capacity.js'
import { ClusterReader } from '../src/k8s/cluster-reader.js'
import { DeploymentScaler } from '../src/k8s/deployment-scaler.js'
import { SpaceService } from '../src/k8s/space.service.js'
import { JWKS_URL, keySet, token } from './auth-helpers.js'
import { validSpec } from './spec-fixture.js'
import { startApp } from './start-app.js'

const REST = 'https://test.supabase.co/rest/v1/'
const GOCD_URL = 'https://gocd.test/go/api/pipelines/student-deploy/schedule'
const AI_URL = 'https://ai.test/agent/tickets'
const EXPLAIN_URL = 'https://ai.test/agent/explanations'
const CLOSE_URL = `${AI_URL}/t_stale/close`
const STUDENT_HOOK = 'https://discord.com/api/webhooks/222/student-token'
const NOTIFY_TOKEN = 'pipeline_notify_test_0123456789abcdef'
const SHA = '0123456789abcdef0123456789abcdef01234567'
const USER = '11111111-1111-4111-8111-111111111111'
const IMAGE = `ghcr.io/woowang-bot/student-apps@sha256:${'c'.repeat(64)}`
const OLD_IMAGE = `ghcr.io/woowang-bot/student-apps@sha256:${'d'.repeat(64)}`
const FE_HASH = `sha256:${'a'.repeat(64)}`
const BE_HASH = `sha256:${'b'.repeat(64)}`

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
// 대상 슬롯 Pod(문제 티켓 로그): rawObjects가 줄 Pod 원본, 로그 글, 받은 호출. 'hang'이면 답하지 않는다.
let slotPods: Record<string, unknown>[] | Error | 'hang'
let podLog: string
let clusterCalls: unknown[][]
let scaled: { slug: string; name: string }[]
let scaleFails: Record<string, Error>
// 가짜 클러스터 사용률: true면 자리가 없다.
let clusterFull: boolean
// 가짜 공간 만들기: 부른 slug와 그때까지의 GoCD 호출 수(순서를 본다). spaceFails가 있으면 그것으로 실패한다.
let spaceCalls: { slug: string; gocdCallsBefore: number }[]
let spaceFails: Error | undefined
let app: INestApplication<App>
// 학생 Discord 웹후크로 보낸 글.
let discord: { url: string; content: string }[]
// AI 서버 설명 요청의 답 · 받은 본문. 기본은 유효한 설명이다.
let explainAnswer: () => Response | Promise<Response>
let explainBodies: unknown[]
const EXPLANATION = { summary: '배포가 끝났어요.', steps: [], cause: null, actions: [], terms: [] }

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
    } else if (v.startsWith('lt.')) {
      // 시각 비교. PostgREST처럼 null은 어느 쪽에도 맞지 않는다.
      if (typeof row[k] !== 'string' || !(Date.parse(row[k]) < Date.parse(v.slice(3)))) return false
    } else throw new Error(`unexpected filter ${k}=${v}`)
  }
  return true
}

// PostgREST의 가짜: 필터(eq · in · lt), order=created_at.desc · created_at.asc · updated_at.asc, limit, upsert(on_conflict), deploy_runs의 유일성 제약.
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
    if (url.searchParams.get('order') === 'created_at.asc') out = [...out].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    if (url.searchParams.get('order') === 'updated_at.asc') out = [...out].sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))
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
      if (rows.some((r) => r.slug === input.slug && ['queued', 'running', 'fixing'].includes(r.status as string))) return conflict('deploy_runs_active_slug_idx')
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
  if (url === EXPLAIN_URL) {
    explainBodies.push(JSON.parse(init?.body as string))
    return Promise.resolve().then(() => explainAnswer())
  }
  if (url === CLOSE_URL) return Promise.resolve(new Response(null, { status: 204 }))
  if (url === STUDENT_HOOK) {
    discord.push({ url, content: (JSON.parse(init?.body as string) as { content: string }).content })
    return Promise.resolve(new Response(null, { status: 204 }))
  }
  return Promise.reject(new Error(`unexpected fetch ${url}`))
})
const callsTo = (url: string) => fetchMock.mock.calls.filter(([u]) => urlOf(u) === url)
const fakeSpace = {
  ensureSpace: (slug: string) => {
    spaceCalls.push({ slug, gocdCallsBefore: callsTo(GOCD_URL).length })
    return spaceFails ? Promise.reject(spaceFails) : Promise.resolve()
  },
}
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
    // 설명은 전체 spec 모양(서비스의 build · health)을 읽는다.
    spec: validSpec(),
  },
})

const bearer = async (sub = USER) => `Bearer ${await token({ sub })}`
const as = async (r: request.Test, auth?: string | null) => r.set(auth === null ? {} : { Authorization: auth ?? (await bearer()) })
const start = async (id: string, auth?: string | null) => as(request(app.getHttpServer()).post(`/api/deploys/${id}/start`), auth)
const status = async (id: string, auth?: string | null) => as(request(app.getHttpServer()).get(`/api/deploys/${id}/status`), auth)
const machine = (r: request.Test, t: string | null = NOTIFY_TOKEN) => (t === null ? r : r.set('Authorization', `Bearer ${t}`))
const notify = (body: unknown, t?: string | null) => machine(request(app.getHttpServer()).post('/api/pipeline/notify').send(body as object), t)
const run = (id: string) => db.deploy_runs.find((r) => r.deploy_id === id)!

beforeEach(async () => {
  db = {}
  clock = 0
  gocdAnswer = () => new Response('{"message":"Request to schedule pipeline accepted"}', { status: 202 })
  aiAnswer = () => Response.json({ ticketId: 't_x' }, { status: 202 })
  prepare = (id) => Promise.resolve(preparedFor(id))
  restOverride = undefined
  clusterFull = false
  spaceCalls = []
  spaceFails = undefined
  spaceDeployments = []
  slotPods = []
  podLog = ''
  clusterCalls = []
  scaled = []
  scaleFails = {}
  discord = []
  explainAnswer = () => Response.json(EXPLANATION)
  explainBodies = []
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  app = await startApp([], (b) =>
    b
      .overrideProvider(DeployPreparer)
      .useValue({ prepareIfReady: (id: string) => prepare(id) })
      .overrideProvider(ClusterReader)
      .useValue({
        deployments: () => (spaceDeployments instanceof Error ? Promise.reject(spaceDeployments) : Promise.resolve(spaceDeployments.map((name) => ({ name })))),
        rawObjects: (slug: string, kind: string, selector?: string) => {
          clusterCalls.push(['rawObjects', slug, kind, selector])
          if (slotPods === 'hang') return new Promise(() => undefined)
          return slotPods instanceof Error ? Promise.reject(slotPods) : Promise.resolve(slotPods)
        },
        logs: (slug: string, pod: string, options: unknown) => {
          clusterCalls.push(['logs', slug, pod, options])
          return Promise.resolve(podLog)
        },
      })
      .overrideProvider(ClusterCapacity)
      .useValue({ isFull: () => Promise.resolve(clusterFull) })
      .overrideProvider(SpaceService)
      .useValue(fakeSpace)
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

const succeed = async (id: string) => {
  await notify({ deployId: id, stage: 'build', result: 'passed', images: { fe: IMAGE } })
  for (const stage of ['prepare', 'render', 'apply', 'verify']) await notify({ deployId: id, stage, result: 'passed' })
  await notify({ deployId: id, stage: 'switch', result: 'passed' })
}
const explanationOf = async (id: string) => ((await status(id)).body as { explanation: { state: string; content: unknown } | null }).explanation
const settle = () => new Promise((r) => setTimeout(r, 10))

describe('deploy explanation (DEPLOY_EXPLAIN_ENABLED=true)', () => {
  it('is null while running, pending right after the run ends, then ready when the AI answers', async () => {
    const id = seedDeploy()
    let release: (r: Response) => void = () => undefined
    const gate = new Promise<Response>((r) => (release = r))
    explainAnswer = () => gate

    await start(id)
    expect(await explanationOf(id)).toBeNull()
    await succeed(id)
    expect(run(id)).toMatchObject({ status: 'succeeded' })
    expect(await explanationOf(id)).toEqual({ state: 'pending', content: null })

    release(Response.json(EXPLANATION))
    await settle()
    expect(await explanationOf(id)).toEqual({ state: 'ready', content: EXPLANATION })
    const asked = fetchMock.mock.calls.filter(([u]) => urlOf(u) === EXPLAIN_URL)
    expect(asked).toHaveLength(1)
    expect(asked[0][1]?.headers).toMatchObject({ Authorization: 'Bearer agent_token_test' })
    expect(JSON.parse(asked[0][1]?.body as string)).toMatchObject({ deployId: id, outcome: 'succeeded', firstDeploy: true })
  })

  it('leaves the deploy itself unchanged when the AI server answers 500', async () => {
    explainAnswer = () => new Response('boom', { status: 500 })
    const id = seedDeploy()
    await start(id)
    await succeed(id)
    await settle()
    expect(run(id)).toMatchObject({ status: 'succeeded', stage: null })
    expect(await explanationOf(id)).toEqual({ state: 'failed', content: null })
    expect((await status(id)).body).toMatchObject({ status: 'succeeded', url: 'https://my-app.stairnoworks.com' })
    expect(db.projects).toEqual([expect.objectContaining({ slug: 'my-app', live_slot: 'a' })])
    // 티켓 · 종료 알림 · 학생 Discord 글은 설명과 무관하다.
    expect(callsTo(AI_URL)).toHaveLength(0)
    expect(fetchMock.mock.calls.filter(([u]) => urlOf(u).endsWith('/close'))).toEqual([])
    expect(discord).toHaveLength(0)
  })
})
