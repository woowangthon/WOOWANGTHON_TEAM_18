import { randomUUID } from 'node:crypto'
import { type INestApplication, Logger } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClusterError } from '../src/k8s/cluster-error.js'
import { ClusterReader, type DeploymentInfo, type NodeInfo, type NodeUsageInfo, type PodInfo, type PodUsageInfo } from '../src/k8s/cluster-reader.js'
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
// Pod 사용량(metrics.k8s.io): 공간마다. podUsageErrors에 slug가 있으면 그 오류로 실패한다.
let podUsageData: Record<string, PodUsageInfo[]>
let podUsageErrors: Record<string, Error>
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
  podUsage: (slug: string) => (podUsageErrors[slug] ? Promise.reject(podUsageErrors[slug]) : Promise.resolve(podUsageData[slug] ?? [])),
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
    // on_conflict가 있으면 같은 키의 줄에 보낸 칸만 합친다(PostgREST의 merge-duplicates).
    const key = url.searchParams.get('on_conflict')
    const known = key === null ? undefined : rows.find((r) => r[key] === row[key])
    if (known) return Response.json([Object.assign(known, row)], { status: 201 })
    row.created_at = new Date().toISOString()
    if (table === 'projects') Object.assign(row, { live_slot: null, hidden_at: null, ...row })
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
  podUsageData = {}
  podUsageErrors = {}
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
  ['post', '/api/admin/projects/my-app/hide'],
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

const slugsOf = (res: { body: unknown }) => (res.body as { projects: { slug: string }[] }).projects.map((p) => p.slug)
const seedMany = (n: number) => {
  for (let i = 0; i < n; i++) {
    const slug = `app-${String(i).padStart(2, '0')}`
    seedProject(slug, USER, i)
    space(slug, [deployment('fe-a')])
  }
}

describe('GET /api/admin/projects paging, search and status filter', () => {
  it('pages the list, newest first, ten at a time by default, with the total', async () => {
    seedMany(25)
    const first = (await call('get', '/api/admin/projects', undefined)).body as { projects: { slug: string }[]; page: number; pageSize: number; total: number }
    expect([first.page, first.pageSize, first.total, first.projects.length]).toEqual([1, 10, 25, 10])
    expect(first.projects[0].slug).toBe('app-24')
    const last = await call('get', '/api/admin/projects?page=3&pageSize=10', undefined)
    expect(slugsOf(last)).toEqual(['app-04', 'app-03', 'app-02', 'app-01', 'app-00'])
    // 범위를 넘은 쪽은 빈 목록이고 total은 그대로다.
    const beyond = await call('get', '/api/admin/projects?page=9', undefined)
    expect(beyond.body).toEqual({ projects: [], page: 9, pageSize: 10, total: 25 })
  })

  it('reads the cluster only for the projects on the shown page when no status filter is set', async () => {
    seedMany(25)
    const spy = vi.spyOn(reader, 'deployments')
    await call('get', '/api/admin/projects?pageSize=5', undefined)
    expect(spy).toHaveBeenCalledTimes(5)
  })

  it('searches by slug or repo, ignoring case and surrounding spaces', async () => {
    seedProject('shop', USER, 3)
    seedProject('blog', USER, 2)
    ;(db.deploys ?? []).push({ id: randomUUID(), user_id: USER, slug: 'docs', repo: 'Team/Shop-Docs', created_at: new Date(Date.UTC(2026, 10, 11, 1, 0, 1)).toISOString() })
    space('shop', [deployment('fe-a')])
    space('blog', [deployment('fe-a')])
    space('docs', [deployment('fe-a')])
    expect(slugsOf(await call('get', '/api/admin/projects?q=%20SHOP%20', undefined))).toEqual(['shop', 'docs'])
    expect(slugsOf(await call('get', '/api/admin/projects?q=blog', undefined))).toEqual(['blog'])
    const none = await call('get', '/api/admin/projects?q=zzz', undefined)
    expect(none.body).toEqual({ projects: [], page: 1, pageSize: 10, total: 0 })
  })

  it('filters by running or stopped the way the card does, and pages the filtered list', async () => {
    seedProject('up', USER, 5)
    seedProject('down', USER, 4)
    seedProject('empty', USER, 3)
    seedProject('broken', USER, 2)
    space('up', [deployment('fe-a'), deployment('be-a', 0, 0)])
    space('down', [deployment('fe-a', 0, 0)])
    space('empty', [])
    space('broken', [deployment('fe-a')])
    slugErrors.broken = new ClusterError('unreachable')
    expect(slugsOf(await call('get', '/api/admin/projects?status=running', undefined))).toEqual(['up'])
    const stopped = await call('get', '/api/admin/projects?status=stopped&pageSize=1&page=2', undefined)
    expect(stopped.body).toMatchObject({ total: 2, page: 2 })
    expect(slugsOf(stopped)).toEqual(['empty'])
    expect(slugsOf(await call('get', '/api/admin/projects?status=all', undefined))).toEqual(['up', 'down', 'empty', 'broken'])
  })

  it.each(['page=0', 'page=1.5', 'page=abc', 'pageSize=0', 'pageSize=51', 'status=paused', 'status=', `q=${'a'.repeat(101)}`, 'page=1&page=2'])(
    'refuses %s with 400 INVALID_QUERY before touching the cluster',
    async (query) => {
      const spy = vi.spyOn(reader, 'deployments')
      const res = await call('get', `/api/admin/projects?${query}`, undefined)
      expect(res.status).toBe(400)
      expect(res.body).toEqual(errorBody('INVALID_QUERY'))
      expect(spy).not.toHaveBeenCalled()
    },
  )
})

describe('POST /api/admin/projects/:slug/hide', () => {
  it('hides a stopped project from the list without touching the cluster, and keeps the others', async () => {
    seedProject('my-app', USER, 1)
    seedProject('other', USER, 2)
    space('my-app', [deployment('fe-a', 0, 0)])
    space('other', [deployment('fe-a')])
    const res = await call('post', '/api/admin/projects/my-app/hide', undefined)
    expect([res.status, res.body]).toEqual([200, { slug: 'my-app' }])
    expect(scaled).toEqual([])
    expect(slugsOf(await call('get', '/api/admin/projects', undefined))).toEqual(['other'])
    expect(slugsOf(await call('get', '/api/admin/projects?q=my-app', undefined))).toEqual([])
    // 숨겨도 이전의 live_slot은 그대로다(줄을 합쳐 쓴다).
    expect((db.projects ?? []).find((r) => r.slug === 'my-app')).toMatchObject({ live_slot: null })
  })

  it('also hides a project whose namespace is gone', async () => {
    seedProject('my-app')
    expect((await call('post', '/api/admin/projects/my-app/hide', undefined)).status).toBe(200)
    expect(slugsOf(await call('get', '/api/admin/projects', undefined))).toEqual([])
  })

  it('keeps the live slot of a project that already has a row', async () => {
    seedProject('my-app')
    db.projects = [{ slug: 'my-app', live_slot: 'b', hidden_at: null }]
    space('my-app', [deployment('fe-a', 0, 0)])
    await call('post', '/api/admin/projects/my-app/hide', undefined)
    expect(db.projects[0]).toMatchObject({ live_slot: 'b' })
    expect(db.projects[0].hidden_at).toEqual(expect.any(String))
  })

  it('refuses a running project with 409 NOT_STOPPED and changes nothing', async () => {
    seedProject('my-app')
    space('my-app', [deployment('fe-a', 0, 0), deployment('be-a')])
    const res = await call('post', '/api/admin/projects/my-app/hide', undefined)
    expect(res.status).toBe(409)
    expect(res.body).toEqual(errorBody('NOT_STOPPED'))
    expect(db.projects ?? []).toEqual([])
    expect(slugsOf(await call('get', '/api/admin/projects', undefined))).toEqual(['my-app'])
  })

  it('brings a hidden project back when it is deployed again', async () => {
    seedProject('my-app', USER, 0)
    space('my-app', [deployment('fe-a', 0, 0)])
    await call('post', '/api/admin/projects/my-app/hide', undefined)
    expect(slugsOf(await call('get', '/api/admin/projects', undefined))).toEqual([])
    ;(db.deploys ??= []).push({ id: randomUUID(), user_id: USER, slug: 'my-app', repo: 'Student/my-app', created_at: new Date(Date.now() + 60_000).toISOString() })
    expect(slugsOf(await call('get', '/api/admin/projects', undefined))).toEqual(['my-app'])
  })

  it('answers 404 for an unknown slug or one that is not a slug, and 503 when the cluster cannot be read', async () => {
    expect((await call('post', '/api/admin/projects/nope/hide', undefined)).status).toBe(404)
    expect((await call('post', '/api/admin/projects/Bad_Slug/hide', undefined)).status).toBe(404)
    seedProject('my-app')
    clusterError = new ClusterError('unreachable')
    const res = await call('post', '/api/admin/projects/my-app/hide', undefined)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('CLUSTER_UNREACHABLE'))
    expect(db.projects ?? []).toEqual([])
  })

  it('answers 503 DATABASE_UNAVAILABLE when the record cannot be written, and the project stays listed', async () => {
    seedProject('my-app')
    space('my-app', [deployment('fe-a', 0, 0)])
    restOverride = (table, method) => (table === 'projects' && method === 'POST' ? new Response('x', { status: 500 }) : undefined)
    const res = await call('post', '/api/admin/projects/my-app/hide', undefined)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('DATABASE_UNAVAILABLE'))
    restOverride = undefined
    expect(slugsOf(await call('get', '/api/admin/projects', undefined))).toEqual(['my-app'])
  })
})

describe('GET /api/admin/projects', () => {
  it('joins the database with each project namespace: services, pods, nodes, restarts, address, last stop', async () => {
    seedProject('my-app', USER, 5)
    seedProject('old-app', 'other', 1)
    db.projects = [{ slug: 'my-app', live_slot: 'a', hidden_at: null }]
    db.admin_actions = [
      { slug: 'my-app', action: 'stop', actor_email: 'older@example.com', created_at: '2026-11-10T02:00:00.000Z' },
      { slug: 'my-app', action: 'stop', actor_email: 'op@example.com', created_at: '2026-11-11T02:00:00.000Z' },
    ]
    space('my-app', [deployment('fe-a'), deployment('be-a', 0, 0), deployment('fe', 2, 1)], [pod('fe-a-6d9f8c7b5-xk2ab', 3), pod('fe-6d9f8c7b5-aaaaa', 0, false), pod('be-a-5c4d-bbbbb'), pod('fe-a-extra-6d9f8c7b5-zzzzz'), pod('fe-a-6d9f8c7b5-toolong1')])
    // fe-a는 컨테이너 둘의 합(41m, 21Mi). fe의 Pod는 첫 수집 전이라 목록에 없다. 이름이 겹치는 다른 서비스의 Pod 값은 섞이지 않는다.
    podUsageData['my-app'] = [
      { name: 'fe-a-6d9f8c7b5-xk2ab', containers: [{ cpu: '40m', memory: '20Mi' }, { cpu: '1m', memory: '1Mi' }] },
      { name: 'fe-a-extra-6d9f8c7b5-zzzzz', containers: [{ cpu: '900m', memory: '1Gi' }] },
      { name: 'be-a-5c4d-bbbbb', containers: [{ cpu: '2m', memory: '3Mi' }] },
    ]

    const res = await call('get', '/api/admin/projects', undefined)
    expect(res.status).toBe(200)
    const { projects } = res.body as { projects: Record<string, unknown>[] }
    // 최근에 저장한 프로젝트부터
    expect(projects.map((p) => p.slug)).toEqual(['my-app', 'old-app'])
    expect(projects[0]).toEqual({
      slug: 'my-app', repo: 'Student/my-app', ownerId: USER, liveSlot: 'a', url: 'https://my-app.stairnoworks.com', clusterError: null,
      lastStop: { at: '2026-11-11T02:00:00.000Z', by: 'op@example.com' },
      usageStatus: 'collected',
      services: [
        { name: 'fe-a', slot: 'a', replicas: 1, readyReplicas: 1, restarts: 3, usage: { cpuMillicores: 41, memoryBytes: 21 * 1024 ** 2 }, pods: [{ name: 'fe-a-6d9f8c7b5-xk2ab', phase: 'Running', ready: true, node: 'worker-1', restarts: 3 }] },
        { name: 'be-a', slot: 'a', replicas: 0, readyReplicas: 0, restarts: 0, usage: { cpuMillicores: 2, memoryBytes: 3 * 1024 ** 2 }, pods: [{ name: 'be-a-5c4d-bbbbb', phase: 'Running', ready: true, node: 'worker-1', restarts: 0 }] },
        { name: 'fe', slot: null, replicas: 2, readyReplicas: 1, restarts: 0, usage: null, pods: [{ name: 'fe-6d9f8c7b5-aaaaa', phase: 'Running', ready: false, node: 'worker-1', restarts: 0 }] },
      ],
    })
    // 공간이 없는(403) 프로젝트와 아직 전환하지 않은 프로젝트
    expect(projects[1]).toMatchObject({ slug: 'old-app', liveSlot: null, url: null, lastStop: null, services: [] })
  })

  it('keeps the services and says "not_collected" for a project whose Pod usage cannot be read, without touching the others', async () => {
    seedProject('my-app', USER, 5)
    seedProject('other-app', USER, 1)
    space('my-app', [deployment('fe-a')], [pod('fe-a-6d9f8c7b5-xk2ab', 2)])
    space('other-app', [deployment('fe-a')], [pod('fe-a-6d9f8c7b5-yyyyy')])
    podUsageErrors['my-app'] = new ClusterError('forbidden', 403)
    podUsageData['other-app'] = [{ name: 'fe-a-6d9f8c7b5-yyyyy', containers: [{ cpu: '5m', memory: '1Mi' }] }]
    const { projects } = (await call('get', '/api/admin/projects', undefined)).body as { projects: Record<string, unknown>[] }
    expect(projects[0]).toMatchObject({ slug: 'my-app', usageStatus: 'not_collected', clusterError: null, services: [{ name: 'fe-a', restarts: 2, usage: null }] })
    expect(projects[1]).toMatchObject({ slug: 'other-app', usageStatus: 'collected', services: [{ usage: { cpuMillicores: 5, memoryBytes: 1024 ** 2 } }] })
  })

  it('never invents a usage figure: an unreadable quantity or a Pod missing from the list gives null', async () => {
    seedProject('my-app')
    space('my-app', [deployment('fe-a', 2, 2), deployment('be-a')], [pod('fe-a-6d9f8c7b5-aaaaa'), pod('fe-a-6d9f8c7b5-bbbbb'), pod('be-a-5c4d-ccccc')])
    // be-a의 값이 쿠버네티스 수량이 아니다. fe-a는 Pod 하나만 목록에 있어 있는 것만 더한다.
    podUsageData['my-app'] = [
      { name: 'fe-a-6d9f8c7b5-aaaaa', containers: [{ cpu: '10m', memory: '2Mi' }] },
      { name: 'be-a-5c4d-ccccc', containers: [{ cpu: 'lots', memory: '2Mi' }] },
    ]
    const { projects } = (await call('get', '/api/admin/projects', undefined)).body as { projects: { services: unknown[] }[] }
    expect(projects[0].services).toMatchObject([{ name: 'fe-a', usage: { cpuMillicores: 10, memoryBytes: 2 * 1024 ** 2 } }, { name: 'be-a', usage: null }])
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
    expect((await call('get', '/api/admin/projects', undefined)).body).toEqual({ projects: [], page: 1, pageSize: 10, total: 0 })
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
