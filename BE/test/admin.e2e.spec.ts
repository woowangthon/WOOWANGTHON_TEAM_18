import { randomUUID } from 'node:crypto'
import { type INestApplication, Logger } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClusterError } from '../src/k8s/cluster-error.js'
import { ClusterReader, type DeploymentInfo, type NodeInfo, type NodeUsageInfo, type PodInfo } from '../src/k8s/cluster-reader.js'
import { DeploymentScaler } from '../src/k8s/deployment-scaler.js'
import { errorBody, JWKS_URL, keySet, token } from './auth-helpers.js'
import { startApp } from './start-app.js'

const REST = 'https://test.supabase.co/rest/v1/'
const ADMIN = '99999999-9999-4999-8999-999999999999'
const USER = '11111111-1111-4111-8111-111111111111'

type Row = Record<string, unknown>
let db: Record<string, Row[]>
let restOverride: ((table: string, method: string) => Response | undefined) | undefined
// 가짜 클러스터: 공간(slug)마다 Deployment · Pod 목록을 두고(없으면 리더가 답하듯 403 = forbidden), clusterError가 있으면 모든 읽기가 그 오류로 실패한다.
// scale은 기록하고 scaleFails에 이름이 있으면 그 오류로 실패한다.
let nodesData: NodeInfo[]
// 노드 사용량(metrics.k8s.io). usageError가 있으면 그 오류로 실패한다.
let usageData: NodeUsageInfo[]
let usageError: Error | undefined
let spaces: Record<string, { deployments: DeploymentInfo[]; pods: PodInfo[] }>
let slugErrors: Record<string, ClusterError>
let clusterError: ClusterError | undefined
let scaleFails: Record<string, ClusterError>
let scaled: { slug: string; name: string }[]
let app: INestApplication<App>

const read = <T>(slug: string | null, pick: (space: (typeof spaces)[string]) => T[]): Promise<T[]> => {
  if (clusterError) return Promise.reject(clusterError)
  if (slug === null) return Promise.resolve(nodesData as T[])
  if (slugErrors[slug]) return Promise.reject(slugErrors[slug])
  return slug in spaces ? Promise.resolve(pick(spaces[slug])) : Promise.reject(new ClusterError('forbidden', 403))
}
const reader = {
  nodes: () => read<NodeInfo>(null, () => []),
  nodeUsage: () => (usageError ? Promise.reject(usageError) : Promise.resolve(usageData)),
  deployments: (slug: string) => read(slug, (space) => space.deployments),
  pods: (slug: string) => read(slug, (space) => space.pods),
}
const scaler: Pick<DeploymentScaler, 'scaleToZero'> = {
  scaleToZero(slug, name) {
    if (scaleFails[name]) return Promise.reject(scaleFails[name])
    scaled.push({ slug, name })
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

const node = (name: string, roles: string[] = [], over: Partial<NodeInfo> = {}): NodeInfo => ({
  name,
  ready: true,
  roles,
  capacity: { cpu: '4', memory: '16Gi', 'ephemeral-storage': '250000000000' },
  allocatable: { cpu: '3800m', memory: '15000000Ki', 'ephemeral-storage': '230000000000' },
  ...over,
})
const deployment = (name: string, replicas = 1, ready = 1): DeploymentInfo => ({ name, labels: {}, replicas, ready, updated: ready, available: ready })
const pod = (name: string, restarts = 0, ready = true): PodInfo => ({ name, labels: {}, phase: 'Running', node: 'worker-1', ready, restarts, waiting: null })
const seedProject = (slug = 'my-app', userId = USER, created = 0) =>
  (db.deploys ??= []).push({ id: randomUUID(), user_id: userId, slug, repo: `Student/${slug}`, created_at: new Date(Date.UTC(2026, 10, 11, 1, 0, created)).toISOString() })
const space = (slug: string, deployments: DeploymentInfo[], pods: PodInfo[] = []) => (spaces[slug] = { deployments, pods })

const adminAuth = async () => `Bearer ${await token({ sub: ADMIN, email: 'op@example.com', app_metadata: { role: 'admin' } })}`
const userAuth = async () => `Bearer ${await token({ sub: USER, app_metadata: { role: 'student' } })}`
const call = async (method: 'get' | 'post', path: string, auth: string | null | undefined) =>
  request(app.getHttpServer())[method](path).set(auth === null ? {} : { Authorization: auth ?? (await adminAuth()) })

beforeEach(async () => {
  db = {}
  restOverride = undefined
  nodesData = []
  usageData = []
  usageError = undefined
  spaces = {}
  slugErrors = {}
  clusterError = undefined
  scaleFails = {}
  scaled = []
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  app = await startApp([], (b) => b.overrideProvider(ClusterReader).useValue(reader).overrideProvider(DeploymentScaler).useValue(scaler))
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
    const spies = [vi.spyOn(reader, 'nodes'), vi.spyOn(reader, 'deployments'), vi.spyOn(reader, 'pods'), vi.spyOn(scaler, 'scaleToZero')]
    const res = await call(method, path, await userAuth())
    expect(res.status).toBe(403)
    expect(res.body).toEqual(errorBody('ADMIN_REQUIRED'))
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.map(([u]) => urlOf(u)).filter((u) => u !== JWKS_URL)).toEqual([])
  })

  it('does not trust user_metadata for the admin role', async () => {
    const forged = `Bearer ${await token({ sub: USER, user_metadata: { role: 'admin' } })}`
    expect((await call('get', '/api/admin/nodes', forged)).status).toBe(403)
  })
})

describe('GET /api/admin/nodes', () => {
  it('lists nodes with role, readiness and capacity, and never invents usage', async () => {
    nodesData = [
      node('leader', ['control-plane']),
      node('worker-1'),
      node('worker-2', [], { ready: false, capacity: {}, allocatable: { cpu: 'oops' } }),
    ]
    usageData = [{ name: 'leader', usage: { cpu: '123018642n', memory: '6838040Ki' } }]
    const res = await call('get', '/api/admin/nodes', undefined)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      usageStatus: 'collected',
      nodes: [
        {
          name: 'leader', ready: true, role: 'leader',
          cpu: { capacityMillicores: 4000, allocatableMillicores: 3800 },
          memory: { capacityBytes: 16 * 2 ** 30, allocatableBytes: 15_000_000 * 1024 },
          disk: { capacityBytes: 250_000_000_000, allocatableBytes: 230_000_000_000 },
          usage: { cpuMillicores: 123, memoryBytes: 6838040 * 1024 },
        },
        // 사용량 목록에 없는 노드(첫 수집 전)는 null이다.
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

  it('fills each node with its own usage, and leaves null when a quantity cannot be read', async () => {
    nodesData = [node('leader', ['control-plane']), node('worker-1'), node('worker-2'), node('worker-3')]
    usageData = [
      { name: 'worker-1', usage: { cpu: '2500m', memory: '1Gi' } },
      { name: 'leader', usage: { cpu: '1', memory: '512Mi' } },
      { name: 'worker-2', usage: { cpu: 'oops', memory: '1Gi' } },
      { name: 'worker-3', usage: { cpu: '1' } },
      { name: 'not-a-node', usage: { cpu: '1', memory: '1Gi' } },
    ]
    const res = await call('get', '/api/admin/nodes', undefined)
    expect(res.body).toMatchObject({
      usageStatus: 'collected',
      nodes: [
        { name: 'leader', usage: { cpuMillicores: 1000, memoryBytes: 512 * 2 ** 20 } },
        { name: 'worker-1', usage: { cpuMillicores: 2500, memoryBytes: 2 ** 30 } },
        { name: 'worker-2', usage: null },
        { name: 'worker-3', usage: null },
      ],
    })
    expect((res.body as { nodes: unknown[] }).nodes).toHaveLength(4)
  })

  it.each([
    ['the account has no permission', new ClusterError('forbidden', 403)],
    ['the metrics API is not served', new ClusterError('not_found', 404)],
    ['the leader does not answer', new ClusterError('unreachable')],
    ['something unexpected broke', new Error('boom secret-value')],
  ])('keeps the node list with usage null and not_collected when %s, and logs no message text', async (_, error) => {
    nodesData = [node('leader', ['control-plane']), node('worker-1')]
    usageError = error
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const res = await call('get', '/api/admin/nodes', undefined)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ usageStatus: 'not_collected', nodes: [{ name: 'leader', usage: null }, { name: 'worker-1', usage: null }] })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/^Node usage not read: (forbidden 403|not_found 404|unreachable|error)$/)
  })

  it('still answers 503 when the node list cannot be read, even if usage could', async () => {
    clusterError = new ClusterError('forbidden', 403)
    usageData = [{ name: 'leader', usage: { cpu: '1', memory: '1Gi' } }]
    const res = await call('get', '/api/admin/nodes', undefined)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('CLUSTER_FORBIDDEN'))
  })

  it('treats the legacy master label as the leader', async () => {
    nodesData = [node('n', ['master'])]
    expect(((await call('get', '/api/admin/nodes', undefined)).body as { nodes: { role: string }[] }).nodes[0].role).toBe('leader')
  })

  it('says the leader did not answer (503 CLUSTER_UNREACHABLE) and, separately, that the account lacks permission', async () => {
    clusterError = new ClusterError('unreachable')
    let res = await call('get', '/api/admin/nodes', undefined)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('CLUSTER_UNREACHABLE'))
    clusterError = new ClusterError('forbidden', 403)
    res = await call('get', '/api/admin/nodes', undefined)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('CLUSTER_FORBIDDEN'))
  })

  it('says the leader did not answer when the answer is not a node list, or the token is not accepted', async () => {
    clusterError = new ClusterError('unexpected', 200)
    expect((await call('get', '/api/admin/nodes', undefined)).body).toEqual(errorBody('CLUSTER_UNREACHABLE'))
    clusterError = new ClusterError('unauthorized', 401)
    expect((await call('get', '/api/admin/nodes', undefined)).body).toEqual(errorBody('CLUSTER_FORBIDDEN'))
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
    space('my-app', [deployment('fe-a'), deployment('be-a', 0, 0), deployment('fe', 2, 1)], [pod('fe-a-6d9f8c7b5-xk2ab', 3), pod('fe-6d9f8c7b5-aaaaa', 0, false), pod('be-a-5c4d-bbbbb'), pod('fe-a-extra-6d9f8c7b5-zzzzz'), pod('fe-a-6d9f8c7b5-toolong1')])

    const res = await call('get', '/api/admin/projects', undefined)
    expect(res.status).toBe(200)
    const { projects } = res.body as { projects: Record<string, unknown>[] }
    // 최근에 저장한 프로젝트부터
    expect(projects.map((p) => p.slug)).toEqual(['my-app', 'old-app'])
    expect(projects[0]).toEqual({
      slug: 'my-app', repo: 'Student/my-app', ownerId: USER, liveSlot: 'a', url: 'https://my-app.stairnoworks.com', clusterError: null,
      lastStop: { at: '2026-11-11T02:00:00.000Z', by: 'op@example.com' },
      services: [
        { name: 'fe-a', slot: 'a', replicas: 1, readyReplicas: 1, pods: [{ name: 'fe-a-6d9f8c7b5-xk2ab', phase: 'Running', ready: true, node: 'worker-1', restarts: 3 }] },
        { name: 'be-a', slot: 'a', replicas: 0, readyReplicas: 0, pods: [{ name: 'be-a-5c4d-bbbbb', phase: 'Running', ready: true, node: 'worker-1', restarts: 0 }] },
        { name: 'fe', slot: null, replicas: 2, readyReplicas: 1, pods: [{ name: 'fe-6d9f8c7b5-aaaaa', phase: 'Running', ready: false, node: 'worker-1', restarts: 0 }] },
      ],
    })
    // 공간이 없는(403) 프로젝트와 아직 전환하지 않은 프로젝트
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
    const spies = [vi.spyOn(reader, 'deployments'), vi.spyOn(reader, 'pods')]
    expect((await call('get', '/api/admin/projects', undefined)).body).toEqual({ projects: [] })
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  it('reads one namespace per project, by slug', async () => {
    seedProject('my-app')
    const spies = [vi.spyOn(reader, 'deployments'), vi.spyOn(reader, 'pods')]
    await call('get', '/api/admin/projects', undefined)
    for (const spy of spies) expect(spy.mock.calls).toEqual([['my-app']])
  })

  it('still lists the other projects when one namespace cannot be read, and marks the one that failed', async () => {
    seedProject('my-app', USER, 5)
    seedProject('bad-app', USER, 1)
    space('my-app', [deployment('fe-a')])
    slugErrors['bad-app'] = new ClusterError('unauthorized', 401)
    const res = await call('get', '/api/admin/projects', undefined)
    expect(res.status).toBe(200)
    const { projects } = res.body as { projects: { slug: string; services: unknown[]; clusterError: string | null }[] }
    expect(projects.map((p) => [p.slug, p.services.length, p.clusterError])).toEqual([['my-app', 1, null], ['bad-app', 0, 'CLUSTER_FORBIDDEN']])
  })

  it('answers 503 CLUSTER_UNREACHABLE when the leader does not answer, and 503 DATABASE_UNAVAILABLE when the database does not', async () => {
    seedProject()
    clusterError = new ClusterError('unreachable')
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
    space('my-app', [deployment('fe-a'), deployment('be-a')])
    const res = await call('post', stopPath, undefined)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ slug: 'my-app', scaled: ['fe-a', 'be-a'], failed: [] })
    expect(scaled).toEqual([{ slug: 'my-app', name: 'fe-a' }, { slug: 'my-app', name: 'be-a' }])
    expect(db.admin_actions).toEqual([expect.objectContaining({ slug: 'my-app', action: 'stop', actor_id: ADMIN, actor_email: 'op@example.com' })])
  })

  it('accepts the empty JSON body the FE sends', async () => {
    seedProject()
    space('my-app', [deployment('fe-a')])
    const res = await request(app.getHttpServer())
      .post(stopPath)
      .set({ Authorization: await adminAuth(), 'Content-Type': 'application/json' })
      .send({})
    expect(res.status).toBe(200)
  })

  it('reports the ones that could not be scaled and still answers 200 when some were', async () => {
    seedProject()
    space('my-app', [deployment('fe-a'), deployment('be-a')])
    scaleFails['be-a'] = new ClusterError('unreachable')
    const res = await call('post', stopPath, undefined)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ slug: 'my-app', scaled: ['fe-a'], failed: ['be-a'] })
  })

  it('answers 503 CLUSTER_FORBIDDEN while the server account has no scale permission (nothing is stopped)', async () => {
    seedProject()
    space('my-app', [deployment('fe-a')])
    scaleFails['fe-a'] = new ClusterError('forbidden', 403)
    const res = await call('post', stopPath, undefined)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('CLUSTER_FORBIDDEN'))
    expect(scaled).toEqual([])
  })

  it('reports the missing permission when some Deployments could not be reached and others were refused', async () => {
    seedProject()
    space('my-app', [deployment('fe-a'), deployment('be-a')])
    scaleFails['fe-a'] = new ClusterError('unreachable')
    scaleFails['be-a'] = new ClusterError('forbidden', 403)
    expect((await call('post', stopPath, undefined)).body).toEqual(errorBody('CLUSTER_FORBIDDEN'))
  })

  it('answers 503 CLUSTER_UNREACHABLE when the leader does not answer', async () => {
    seedProject()
    space('my-app', [deployment('fe-a')])
    scaleFails['fe-a'] = new ClusterError('unreachable')
    expect((await call('post', stopPath, undefined)).body).toEqual(errorBody('CLUSTER_UNREACHABLE'))
  })

  it('answers 404 for an unknown project or a slug that is not a slug (even one that is somehow in the database), and never reaches the cluster', async () => {
    seedProject()
    seedProject('Bad_Slug')
    seedProject('a'.repeat(60))
    const spies = [vi.spyOn(reader, 'deployments'), vi.spyOn(scaler, 'scaleToZero')]
    for (const slug of ['nope', 'Bad_Slug', '..', 'a'.repeat(60)]) {
      const res = await call('post', `/api/admin/projects/${slug}/stop`, undefined)
      expect(res.status).toBe(404)
      expect(res.body).toEqual(errorBody('PROJECT_NOT_FOUND'))
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    expect(scaled).toEqual([])
  })

  it('answers 409 NOT_RUNNING when the namespace or its Deployments are gone, without a record', async () => {
    seedProject()
    for (const items of [undefined, []]) {
      if (items) space('my-app', items)
      const res = await call('post', stopPath, undefined)
      expect(res.status).toBe(409)
      expect(res.body).toEqual(errorBody('NOT_RUNNING'))
    }
    expect(db.admin_actions ?? []).toEqual([])
  })

  it('answers 503 when the record cannot be written, and the same request can be sent again', async () => {
    seedProject()
    space('my-app', [deployment('fe-a')])
    restOverride = (table, method) => (table === 'admin_actions' && method === 'POST' ? new Response('{}', { status: 500 }) : undefined)
    const res = await call('post', stopPath, undefined)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('DATABASE_UNAVAILABLE'))
    restOverride = undefined
    expect((await call('post', stopPath, undefined)).status).toBe(200)
    expect(db.admin_actions).toHaveLength(1)
  })

  it('leaves no record behind when nothing could be stopped', async () => {
    seedProject()
    space('my-app', [deployment('fe-a')])
    scaleFails['fe-a'] = new ClusterError('forbidden', 403)
    await call('post', stopPath, undefined)
    expect(db.admin_actions ?? []).toEqual([])
  })

  it('does not build a request path from a cluster-supplied name that is not a name', async () => {
    seedProject()
    space('my-app', [deployment('fe-a'), deployment('../../x')])
    const res = await call('post', stopPath, undefined)
    expect(res.body).toEqual({ slug: 'my-app', scaled: ['fe-a'], failed: [] })
  })
})
