import { randomUUID } from 'node:crypto'
import { type INestApplication, Logger } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClusterApi, ClusterApiError } from '../src/admin/cluster.api.js'
import { errorBody, JWKS_URL, keySet, token } from './auth-helpers.js'
import { startApp } from './start-app.js'

const REST = 'https://test.supabase.co/rest/v1/'
const ADMIN = '99999999-9999-4999-8999-999999999999'
const USER = '11111111-1111-4111-8111-111111111111'

type Row = Record<string, unknown>
let db: Record<string, Row[]>
let restOverride: ((table: string, method: string) => Response | undefined) | undefined
// 가짜 클러스터: GET은 path로 찾은 본문(없으면 null = 404), PATCH는 기록하고 patchFails가 있으면 그 이름이 던진다.
let clusterGets: Record<string, unknown>
let clusterError: ClusterApiError | undefined
let patchFails: Record<string, ClusterApiError>
let patches: { path: string; body: object }[]
let app: INestApplication<App>

const cluster: ClusterApi = {
  get(path) {
    if (clusterError) return Promise.reject(clusterError)
    return Promise.resolve(path in clusterGets ? clusterGets[path] : null)
  },
  patch(path, body) {
    const name = path.split('/')[7]
    if (patchFails[name]) return Promise.reject(patchFails[name])
    patches.push({ path, body })
    return Promise.resolve()
  },
}

const urlOf = (i: string | URL | Request) => (i instanceof Request ? i.url : i.toString())
function rest(url: URL, init: RequestInit | undefined): Response {
  const table = url.pathname.split('/').pop()!
  const method = init?.method ?? 'GET'
  const forced = restOverride?.(table, method)
  if (forced) return forced
  const rows = (db[table] ??= [])
  if (method === 'POST') {
    const row = JSON.parse(init?.body as string) as Row
    row.created_at = new Date().toISOString()
    rows.push(row)
    return Response.json([row], { status: 201 })
  }
  let out = rows
  for (const [k, v] of url.searchParams) {
    if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3))
  }
  if (url.searchParams.get('order') === 'created_at.desc') out = [...out].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  return Response.json(out.slice(0, Number(url.searchParams.get('limit') ?? out.length)))
}
const fetchMock = vi.fn<typeof fetch>((input, init) => {
  const url = urlOf(input)
  if (url === JWKS_URL) return Promise.resolve(Response.json(keySet))
  if (url.startsWith(REST)) return Promise.resolve().then(() => rest(new URL(url), init))
  return Promise.reject(new Error(`unexpected fetch ${url}`))
})

const node = (name: string, over: Row = {}, labels: Row = {}) => ({
  metadata: { name, labels },
  status: {
    conditions: [{ type: 'Ready', status: 'True' }],
    capacity: { cpu: '4', memory: '16Gi', 'ephemeral-storage': '250000000000' },
    allocatable: { cpu: '3800m', memory: '15000000Ki', 'ephemeral-storage': '230000000000' },
  },
  ...over,
})
const deployment = (name: string, replicas = 1, ready = 1) => ({ metadata: { name }, spec: { replicas }, status: { readyReplicas: ready } })
const pod = (name: string, restarts = 0, ready = true) => ({
  metadata: { name },
  spec: { nodeName: 'worker-1' },
  status: { phase: 'Running', containerStatuses: [{ ready, restartCount: restarts }] },
})
const seedProject = (slug = 'my-app', userId = USER, created = 0) =>
  (db.deploys ??= []).push({ id: randomUUID(), user_id: userId, slug, repo: `Student/${slug}`, created_at: new Date(Date.UTC(2026, 10, 11, 1, 0, created)).toISOString() })
const nsPaths = (slug: string) => ({ deployments: `/apis/apps/v1/namespaces/proj-${slug}/deployments`, pods: `/api/v1/namespaces/proj-${slug}/pods` })

const adminAuth = async () => `Bearer ${await token({ sub: ADMIN, email: 'op@example.com', app_metadata: { role: 'admin' } })}`
const userAuth = async () => `Bearer ${await token({ sub: USER, app_metadata: { role: 'student' } })}`
const call = async (method: 'get' | 'post', path: string, auth: string | null | undefined) =>
  request(app.getHttpServer())[method](path).set(auth === null ? {} : { Authorization: auth ?? (await adminAuth()) })

beforeEach(async () => {
  db = {}
  restOverride = undefined
  clusterGets = {}
  clusterError = undefined
  patchFails = {}
  patches = []
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  app = await startApp([], (b) => b.overrideProvider(ClusterApi).useValue(cluster))
})

afterEach(async () => {
  await app.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const ROUTES: ['get' | 'post', string][] = [
  ['get', '/api/admin/nodes'],
  ['get', '/api/admin/projects'],
  ['post', '/api/admin/projects/my-app/stop'],
]

describe('who may call the admin API', () => {
  it.each(ROUTES)('%s %s needs a login', async (method, path) => {
    expect((await call(method, path, null)).status).toBe(401)
  })

  it.each(ROUTES)('%s %s refuses a student with 403 and touches neither the cluster nor the database', async (method, path) => {
    seedProject()
    const spy = vi.spyOn(cluster, 'get')
    const res = await call(method, path, await userAuth())
    expect(res.status).toBe(403)
    expect(res.body).toEqual(errorBody('ADMIN_REQUIRED'))
    expect(spy).not.toHaveBeenCalled()
    expect(patches).toEqual([])
    expect(fetchMock.mock.calls.map(([u]) => urlOf(u)).filter((u) => u !== JWKS_URL)).toEqual([])
  })

  it('does not trust user_metadata for the admin role', async () => {
    const forged = `Bearer ${await token({ sub: USER, user_metadata: { role: 'admin' } })}`
    expect((await call('get', '/api/admin/nodes', forged)).status).toBe(403)
  })
})

describe('GET /api/admin/nodes', () => {
  it('lists nodes with role, readiness and capacity, and does not invent usage', async () => {
    clusterGets['/api/v1/nodes'] = {
      items: [
        node('leader', {}, { 'node-role.kubernetes.io/control-plane': 'true' }),
        node('worker-1'),
        node('worker-2', { status: { conditions: [{ type: 'Ready', status: 'False' }], capacity: {}, allocatable: { cpu: 'oops' } } }),
      ],
    }
    const res = await call('get', '/api/admin/nodes', undefined)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      usageStatus: 'not_collected',
      nodes: [
        {
          name: 'leader', ready: true, role: 'leader',
          cpu: { capacityMillicores: 4000, allocatableMillicores: 3800 },
          memory: { capacityBytes: 16 * 2 ** 30, allocatableBytes: 15_000_000 * 1024 },
          disk: { capacityBytes: 250_000_000_000, allocatableBytes: 230_000_000_000 },
          usage: null,
        },
        expect.objectContaining({ name: 'worker-1', role: 'worker', ready: true, usage: null }),
        {
          name: 'worker-2', ready: false, role: 'worker',
          cpu: { capacityMillicores: null, allocatableMillicores: null },
          memory: { capacityBytes: null, allocatableBytes: null },
          disk: { capacityBytes: null, allocatableBytes: null },
          usage: null,
        },
      ],
    })
  })

  it('treats the legacy master label as the leader', async () => {
    clusterGets['/api/v1/nodes'] = { items: [node('n', {}, { 'node-role.kubernetes.io/master': '' })] }
    expect(((await call('get', '/api/admin/nodes', undefined)).body as { nodes: { role: string }[] }).nodes[0].role).toBe('leader')
  })

  it('says the leader did not answer (503 CLUSTER_UNREACHABLE) and, separately, that the account lacks permission', async () => {
    clusterError = new ClusterApiError('unreachable')
    let res = await call('get', '/api/admin/nodes', undefined)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('CLUSTER_UNREACHABLE'))
    clusterError = new ClusterApiError('forbidden')
    res = await call('get', '/api/admin/nodes', undefined)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('CLUSTER_FORBIDDEN'))
  })

  it('is an empty list when the cluster answers with something that is not a node list', async () => {
    clusterGets['/api/v1/nodes'] = { weird: true }
    expect((await call('get', '/api/admin/nodes', undefined)).body).toEqual({ usageStatus: 'not_collected', nodes: [] })
  })
})

describe('GET /api/admin/projects', () => {
  it('joins the database with each project namespace: services, pods, nodes, restarts, address, last stop', async () => {
    seedProject('my-app', USER, 5)
    seedProject('old-app', 'other', 1)
    db.projects = [{ slug: 'my-app', live_slot: 'a' }]
    db.admin_actions = [
      { slug: 'my-app', action: 'stop', actor_email: 'older@example.com', created_at: '2026-11-10T02:00:00.000Z' },
      { slug: 'my-app', action: 'stop', actor_email: 'op@example.com', created_at: '2026-11-11T02:00:00.000Z' },
    ]
    const my = nsPaths('my-app')
    clusterGets[my.deployments] = { items: [deployment('fe-a'), deployment('be-a', 0, 0), deployment('fe', 2, 1)] }
    clusterGets[my.pods] = { items: [pod('fe-a-6d9f8c7b5-xk2ab', 3), pod('fe-6d9f8c7b5-aaaaa', 0, false), pod('be-a-5c4d-bbbbb'), pod('fe-a-extra-6d9f8c7b5-zzzzz'), pod('fe-a-6d9f8c7b5-toolong1')] }

    const res = await call('get', '/api/admin/projects', undefined)
    expect(res.status).toBe(200)
    const { projects } = res.body as { projects: Record<string, unknown>[] }
    // 최근에 저장한 프로젝트부터
    expect(projects.map((p) => p.slug)).toEqual(['my-app', 'old-app'])
    expect(projects[0]).toEqual({
      slug: 'my-app', repo: 'Student/my-app', ownerId: USER, liveSlot: 'a', url: 'https://my-app.stairnoworks.com',
      lastStop: { at: '2026-11-11T02:00:00.000Z', by: 'op@example.com' },
      services: [
        { name: 'fe-a', slot: 'a', replicas: 1, readyReplicas: 1, pods: [{ name: 'fe-a-6d9f8c7b5-xk2ab', phase: 'Running', ready: true, node: 'worker-1', restarts: 3 }] },
        { name: 'be-a', slot: 'a', replicas: 0, readyReplicas: 0, pods: [{ name: 'be-a-5c4d-bbbbb', phase: 'Running', ready: true, node: 'worker-1', restarts: 0 }] },
        { name: 'fe', slot: null, replicas: 2, readyReplicas: 1, pods: [{ name: 'fe-6d9f8c7b5-aaaaa', phase: 'Running', ready: false, node: 'worker-1', restarts: 0 }] },
      ],
    })
    // 공간이 없는(404) 프로젝트와 아직 전환하지 않은 프로젝트
    expect(projects[1]).toMatchObject({ slug: 'old-app', liveSlot: null, url: null, lastStop: null, services: [] })
  })

  it('lists a project once even if it has several saved deploys, with the latest one\'s owner', async () => {
    seedProject('my-app', 'first-owner', 1)
    seedProject('my-app', USER, 9)
    const { projects } = (await call('get', '/api/admin/projects', undefined)).body as { projects: { ownerId: string }[] }
    expect(projects).toHaveLength(1)
    expect(projects[0].ownerId).toBe(USER)
  })

  it('is empty when nothing was ever deployed, without calling the cluster', async () => {
    const spy = vi.spyOn(cluster, 'get')
    expect((await call('get', '/api/admin/projects', undefined)).body).toEqual({ projects: [] })
    expect(spy).not.toHaveBeenCalled()
  })

  it('reads one namespace per project, only under proj-<slug>', async () => {
    seedProject('my-app')
    const spy = vi.spyOn(cluster, 'get')
    await call('get', '/api/admin/projects', undefined)
    expect(spy.mock.calls.map(([p]) => p).sort()).toEqual(['/api/v1/namespaces/proj-my-app/pods', '/apis/apps/v1/namespaces/proj-my-app/deployments'])
  })

  it('answers 503 CLUSTER_UNREACHABLE when the leader does not answer, and 503 DATABASE_UNAVAILABLE when the database does not', async () => {
    seedProject()
    clusterError = new ClusterApiError('unreachable')
    expect((await call('get', '/api/admin/projects', undefined)).body).toEqual(errorBody('CLUSTER_UNREACHABLE'))
    clusterError = undefined
    restOverride = (table) => (table === 'deploys' ? new Response('{}', { status: 500 }) : undefined)
    const res = await call('get', '/api/admin/projects', undefined)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('DATABASE_UNAVAILABLE'))
  })
})

describe('POST /api/admin/projects/:slug/stop', () => {
  const stopPath = '/api/admin/projects/my-app/stop'

  it('scales every Deployment of the project to 0 and records who asked', async () => {
    seedProject()
    clusterGets[nsPaths('my-app').deployments] = { items: [deployment('fe-a'), deployment('be-a')] }
    const res = await call('post', stopPath, undefined)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ slug: 'my-app', scaled: ['fe-a', 'be-a'], failed: [] })
    expect(patches).toEqual([
      { path: '/apis/apps/v1/namespaces/proj-my-app/deployments/fe-a/scale', body: { spec: { replicas: 0 } } },
      { path: '/apis/apps/v1/namespaces/proj-my-app/deployments/be-a/scale', body: { spec: { replicas: 0 } } },
    ])
    expect(db.admin_actions).toEqual([expect.objectContaining({ slug: 'my-app', action: 'stop', actor_id: ADMIN, actor_email: 'op@example.com' })])
  })

  it('reports the ones that could not be scaled and still answers 200 when some were', async () => {
    seedProject()
    clusterGets[nsPaths('my-app').deployments] = { items: [deployment('fe-a'), deployment('be-a')] }
    patchFails['be-a'] = new ClusterApiError('unreachable')
    const res = await call('post', stopPath, undefined)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ slug: 'my-app', scaled: ['fe-a'], failed: ['be-a'] })
  })

  it('answers 503 CLUSTER_FORBIDDEN while the server account has no scale permission (nothing is stopped)', async () => {
    seedProject()
    clusterGets[nsPaths('my-app').deployments] = { items: [deployment('fe-a')] }
    patchFails['fe-a'] = new ClusterApiError('forbidden')
    const res = await call('post', stopPath, undefined)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('CLUSTER_FORBIDDEN'))
    expect(patches).toEqual([])
  })

  it('reports the missing permission when some Deployments could not be reached and others were refused', async () => {
    seedProject()
    clusterGets[nsPaths('my-app').deployments] = { items: [deployment('fe-a'), deployment('be-a')] }
    patchFails['fe-a'] = new ClusterApiError('unreachable')
    patchFails['be-a'] = new ClusterApiError('forbidden')
    expect((await call('post', stopPath, undefined)).body).toEqual(errorBody('CLUSTER_FORBIDDEN'))
  })

  it('answers 503 CLUSTER_UNREACHABLE when the leader does not answer', async () => {
    seedProject()
    clusterGets[nsPaths('my-app').deployments] = { items: [deployment('fe-a')] }
    patchFails['fe-a'] = new ClusterApiError('unreachable')
    expect((await call('post', stopPath, undefined)).body).toEqual(errorBody('CLUSTER_UNREACHABLE'))
  })

  it('answers 404 for an unknown project or a slug that is not a slug (even one that is somehow in the database), and never reaches the cluster', async () => {
    seedProject()
    seedProject('Bad_Slug')
    seedProject('a'.repeat(60))
    const spy = vi.spyOn(cluster, 'get')
    for (const slug of ['nope', 'Bad_Slug', '..', 'a'.repeat(60)]) {
      const res = await call('post', `/api/admin/projects/${slug}/stop`, undefined)
      expect(res.status).toBe(404)
      expect(res.body).toEqual(errorBody('PROJECT_NOT_FOUND'))
    }
    expect(spy).not.toHaveBeenCalled()
    expect(patches).toEqual([])
  })

  it('answers 409 NOT_RUNNING when the namespace or its Deployments are gone, without a record', async () => {
    seedProject()
    for (const items of [undefined, []]) {
      if (items) clusterGets[nsPaths('my-app').deployments] = { items }
      const res = await call('post', stopPath, undefined)
      expect(res.status).toBe(409)
      expect(res.body).toEqual(errorBody('NOT_RUNNING'))
    }
    expect(db.admin_actions ?? []).toEqual([])
  })

  it('stops nothing when the record cannot be written', async () => {
    seedProject()
    clusterGets[nsPaths('my-app').deployments] = { items: [deployment('fe-a')] }
    restOverride = (table, method) => (table === 'admin_actions' && method === 'POST' ? new Response('{}', { status: 500 }) : undefined)
    const res = await call('post', stopPath, undefined)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('DATABASE_UNAVAILABLE'))
    expect(patches).toEqual([])
  })

  it('does not build a request path from a cluster-supplied name that is not a name', async () => {
    seedProject()
    clusterGets[nsPaths('my-app').deployments] = { items: [deployment('fe-a'), deployment('../../x')] }
    const res = await call('post', stopPath, undefined)
    expect(res.body).toEqual({ slug: 'my-app', scaled: ['fe-a'], failed: [] })
  })
})
