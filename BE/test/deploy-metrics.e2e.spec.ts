import { randomUUID } from 'node:crypto'
import { type INestApplication, Logger } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClusterError } from '../src/k8s/cluster-error.js'
import { ClusterReader, type DeploymentInfo, type PodInfo, type PodUsageInfo, type RangeSeries } from '../src/k8s/cluster-reader.js'
import { errorBody, JWKS_URL, keySet, token } from './auth-helpers.js'
import { startApp } from './start-app.js'

const REST = 'https://test.supabase.co/rest/v1/'
const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

type Row = Record<string, unknown>
let db: Record<string, Row[]>
// 가짜 클러스터. 오류가 있으면 그 읽기가 그 오류로 실패한다.
let deployments: DeploymentInfo[]
let pods: PodInfo[]
let listError: Error | undefined
let usage: PodUsageInfo[]
let usageError: Error | undefined
let series: { cpu: RangeSeries[]; memory: RangeSeries[] }
let seriesError: Error | undefined
let app: INestApplication<App>

type Range = { start: number; end: number; step: number }
const reader = {
  deployments: vi.fn<(slug: string) => Promise<DeploymentInfo[]>>(() => (listError ? Promise.reject(listError) : Promise.resolve(deployments))),
  pods: vi.fn<(slug: string) => Promise<PodInfo[]>>(() => (listError ? Promise.reject(listError) : Promise.resolve(pods))),
  podUsage: vi.fn<(slug: string) => Promise<PodUsageInfo[]>>(() => (usageError ? Promise.reject(usageError) : Promise.resolve(usage))),
  podRangeSeries: vi.fn<(slug: string, metric: 'cpu' | 'memory', range: Range) => Promise<RangeSeries[]>>((_slug, metric) =>
    seriesError ? Promise.reject(seriesError) : Promise.resolve(series[metric]),
  ),
}

const urlOf = (i: string | URL | Request) => (i instanceof Request ? i.url : i.toString())
// PostgREST의 가짜: eq 필터, order=created_at.desc, limit.
function rest(url: URL): Response {
  const rows = db[url.pathname.split('/').pop()!] ?? []
  let out = rows.filter((r) => [...url.searchParams].every(([k, v]) => !v.startsWith('eq.') || String(r[k]) === v.slice(3)))
  if (url.searchParams.get('order') === 'created_at.desc') out = [...out].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  return Response.json(out.slice(0, Number(url.searchParams.get('limit') ?? out.length)))
}
const fetchMock = vi.fn<typeof fetch>((input) => {
  const url = urlOf(input)
  if (url === JWKS_URL) return Promise.resolve(Response.json(keySet))
  if (url.startsWith(REST)) return Promise.resolve().then(() => rest(new URL(url)))
  return Promise.reject(new Error(`unexpected fetch ${url}`))
})

let clock = 0
const stamp = () => new Date(Date.UTC(2026, 10, 12, 1, 0, clock++)).toISOString()
const seedDeploy = (userId = USER, slug = 'my-app') => {
  const id = randomUUID()
  ;(db.deploys ??= []).push({ id, user_id: userId, slug, repo: `Student/${slug}`, commit_sha: 'a'.repeat(40), spec: {}, created_at: stamp() })
  return id
}
const seedRun = (deployId: string, status: string, slug = 'my-app', slot = 'a') => {
  const at = stamp()
  ;(db.deploy_runs ??= []).push({ deploy_id: deployId, user_id: USER, slug, target_slot: slot, input: {}, status, stage: null, created_at: at, updated_at: at })
}
const live = (slot: string | null = 'a', slug = 'my-app') => (db.projects = [{ slug, live_slot: slot }])
const dep = (name: string, replicas = 1, ready = 1): DeploymentInfo => ({ name, labels: {}, replicas, ready, updated: ready, available: ready })
const pod = (name: string, restarts = 0, waiting: string | null = null): PodInfo => ({ name, labels: {}, phase: 'Running', node: 'worker-1', ready: waiting === null, restarts, waiting, lastExit: null })
const points = (...vs: number[]) => vs.map((v, i) => ({ t: 1000 + i * 60, v }))
const get = async (id: string, auth?: string | null) =>
  request(app.getHttpServer())
    .get(`/api/deploys/${id}/metrics`)
    .set(auth === null ? {} : { Authorization: auth ?? `Bearer ${await token({ sub: USER })}` })

// 성공한 배포 하나와 live 슬롯 a를 준비하고 그 id를 돌려준다.
const liveDeploy = () => {
  const id = seedDeploy()
  seedRun(id, 'succeeded')
  live('a')
  return id
}

beforeEach(async () => {
  db = {}
  clock = 0
  deployments = []
  pods = []
  listError = undefined
  usage = []
  usageError = undefined
  series = { cpu: [], memory: [] }
  seriesError = undefined
  for (const fn of Object.values(reader)) fn.mockClear()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  app = await startApp([], (b) => b.overrideProvider(ClusterReader).useValue(reader))
})

afterEach(async () => {
  await app.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const untouched = () => {
  for (const fn of Object.values(reader)) expect(fn).not.toHaveBeenCalled()
}

describe('GET /api/deploys/:id/metrics — who may read', () => {
  it('needs a login', async () => {
    expect((await get(randomUUID(), null)).status).toBe(401)
  })

  it('answers 404 for someone else\'s deploy, an unknown id and an id that is not a UUID, and never reaches the cluster', async () => {
    const others = seedDeploy(OTHER)
    seedRun(others, 'succeeded')
    live('a')
    for (const id of [others, randomUUID(), 'not-a-uuid']) {
      const res = await get(id)
      expect(res.status).toBe(404)
      expect(res.body).toEqual(errorBody('DEPLOY_NOT_FOUND'))
    }
    untouched()
  })
})

describe('GET /api/deploys/:id/metrics — which deploy is live', () => {
  it.each(['running', 'fixing', 'needs_user', 'failed'])('gives no values while this deploy is %s', async (status) => {
    const id = seedDeploy()
    seedRun(id, status)
    live('a')
    const res = await get(id)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ deployId: id, slug: 'my-app', state: 'not_live', reason: 'not_succeeded', slot: null, services: [], usageStatus: null, series: null })
    untouched()
  })

  it('gives no values for a deploy that was only saved, without a run', async () => {
    const id = seedDeploy()
    expect(((await get(id)).body as { reason: string }).reason).toBe('not_succeeded')
    untouched()
  })

  it('says "superseded" for an older succeeded deploy once a newer one succeeded', async () => {
    const older = seedDeploy()
    seedRun(older, 'succeeded')
    const newer = seedDeploy()
    seedRun(newer, 'succeeded')
    live('b')
    expect(((await get(older)).body as { state: string; reason: string }) ).toMatchObject({ state: 'not_live', reason: 'superseded' })
    expect(((await get(newer)).body as { state: string }).state).toBe('live')
    expect(reader.deployments).toHaveBeenCalledTimes(1)
  })

  it('stays live while a newer deploy is still running on the other slot', async () => {
    const id = liveDeploy()
    seedRun(seedDeploy(), 'running', 'my-app', 'b')
    expect(((await get(id)).body as { state: string }).state).toBe('live')
  })

  it('gives no values for a succeeded deploy whose live slot is not recorded yet', async () => {
    const id = seedDeploy()
    seedRun(id, 'succeeded')
    expect(((await get(id)).body as { reason: string }).reason).toBe('not_succeeded')
    untouched()
  })

  it('does not mix projects: the last succeeded run of another project does not make this deploy "superseded"', async () => {
    const id = liveDeploy()
    seedRun(seedDeploy(OTHER, 'other-app'), 'succeeded', 'other-app')
    expect(((await get(id)).body as { state: string }).state).toBe('live')
  })
})

describe('GET /api/deploys/:id/metrics — a live deploy', () => {
  it('reports the live slot\'s services with state, restarts, usage and a one-hour series', async () => {
    const id = liveDeploy()
    deployments = [dep('fe-a'), dep('be-a', 1, 0), dep('ai-a', 0, 0), dep('fe-b'), dep('be-b')]
    pods = [pod('fe-a-6d9f8c7b5-aaaaa', 1), pod('fe-a-6d9f8c7b5-bbbbb', 2), pod('be-a-5c4d-ccccc', 4, 'CrashLoopBackOff'), pod('fe-b-7f7f7f-ddddd', 9)]
    usage = [
      { name: 'fe-a-6d9f8c7b5-aaaaa', containers: [{ cpu: '30m', memory: '10Mi' }] },
      { name: 'fe-a-6d9f8c7b5-bbbbb', containers: [{ cpu: '12m', memory: '5Mi' }] },
      { name: 'fe-b-7f7f7f-ddddd', containers: [{ cpu: '700m', memory: '1Gi' }] },
    ]
    series = {
      cpu: [{ pod: 'fe-a-6d9f8c7b5-aaaaa', points: points(0.03, 0.04) }, { pod: 'fe-a-1111-eeeee', points: points(0.01) }, { pod: 'fe-b-7f7f7f-ddddd', points: points(0.7) }],
      memory: [{ pod: 'fe-a-6d9f8c7b5-aaaaa', points: points(100, 200) }],
    }

    const res = await get(id)
    expect(res.status).toBe(200)
    const endT = (res.body as { series: { endT: number } }).series.endT
    expect(Math.abs(endT - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(5)
    expect(res.body).toEqual({
      deployId: id,
      slug: 'my-app',
      state: 'live',
      reason: null,
      slot: 'a',
      services: [
        { name: 'fe', deployment: 'fe-a', state: 'running', waiting: null, replicas: 1, readyReplicas: 1, restarts: 3, usage: { cpuMillicores: 42, memoryBytes: 15 * 1024 ** 2 } },
        { name: 'be', deployment: 'be-a', state: 'starting', waiting: 'CrashLoopBackOff', replicas: 1, readyReplicas: 0, restarts: 4, usage: null },
        { name: 'ai', deployment: 'ai-a', state: 'stopped', waiting: null, replicas: 0, readyReplicas: 0, restarts: 0, usage: null },
      ],
      usageStatus: 'collected',
      series: {
        status: 'collected',
        endT,
        windowSeconds: 3600,
        stepSeconds: 60,
        // 서비스 이름은 services와 같고 같은 순서다. 점이 없는 서비스도 빈 배열로 있다. 옛 ReplicaSet의 Pod(fe-a-1111-eeeee)도 같은 서비스로 더한다.
        services: [
          { name: 'fe', cpuMillicores: [{ t: 1000, v: 40 }, { t: 1060, v: 40 }], memoryBytes: [{ t: 1000, v: 100 }, { t: 1060, v: 200 }] },
          { name: 'be', cpuMillicores: [], memoryBytes: [] },
          { name: 'ai', cpuMillicores: [], memoryBytes: [] },
        ],
      },
    })
  })

  it('reads only the live slot, whichever it is', async () => {
    const id = seedDeploy()
    seedRun(id, 'succeeded', 'my-app', 'b')
    live('b')
    deployments = [dep('fe-a'), dep('fe-b'), dep('fe')]
    const { services } = (await get(id)).body as { services: { deployment: string; name: string }[] }
    expect(services.map((s) => [s.name, s.deployment])).toEqual([['fe', 'fe-b']])
  })

  it('asks Prometheus only for this project\'s namespace over one hour in one-minute steps', async () => {
    const id = liveDeploy()
    deployments = [dep('fe-a')]
    const before = Math.floor(Date.now() / 1000)
    const res = await get(id)
    const after = Math.floor(Date.now() / 1000)
    expect(reader.podRangeSeries.mock.calls.map(([slug, metric]) => [slug, metric])).toEqual([['my-app', 'cpu'], ['my-app', 'memory']])
    for (const [, , range] of reader.podRangeSeries.mock.calls) {
      expect(range.end).toBeGreaterThanOrEqual(before)
      expect(range.end).toBeLessThanOrEqual(after)
      expect(range.end - range.start).toBe(3600)
      expect(range.step).toBe(60)
    }
    // endT는 query_range에 넘긴 end와 같다.
    expect((res.body as { series: { endT: number } }).series.endT).toBe(reader.podRangeSeries.mock.calls[0][2].end)
    expect(reader.podUsage.mock.calls).toEqual([['my-app']])
  })

  it('lists every service with empty series when Prometheus has no points yet', async () => {
    const id = liveDeploy()
    deployments = [dep('fe-a'), dep('be-a')]
    const body = (await get(id)).body as { series: { status: string; services: unknown[] } }
    expect(body.series).toMatchObject({ status: 'collected', services: [{ name: 'fe', cpuMillicores: [], memoryBytes: [] }, { name: 'be', cpuMillicores: [], memoryBytes: [] }] })
  })

  it('does not add up the series of a service whose name only starts with the same letters', async () => {
    const id = liveDeploy()
    deployments = [dep('fe-a')]
    series = { cpu: [{ pod: 'fe-a-extra-6d9f8c7b5-zzzzz', points: points(5) }, { pod: 'fe-a-6d9f8c7b5-aaaaa', points: points(0.001) }], memory: [] }
    const body = (await get(id)).body as { series: { services: { cpuMillicores: unknown[] }[] } }
    expect(body.series.services[0].cpuMillicores).toEqual([{ t: 1000, v: 1 }])
  })

  it('is an empty list of services, not an error, when the live slot has no Deployment', async () => {
    const id = liveDeploy()
    deployments = [dep('fe-b')]
    expect((await get(id)).body).toMatchObject({ state: 'live', services: [], series: { status: 'collected', services: [] } })
  })
})

describe('GET /api/deploys/:id/metrics — when something cannot be read', () => {
  it('keeps the services and says "not_collected" when Pod usage cannot be read', async () => {
    const id = liveDeploy()
    deployments = [dep('fe-a')]
    pods = [pod('fe-a-6d9f8c7b5-aaaaa', 2)]
    series = { cpu: [{ pod: 'fe-a-6d9f8c7b5-aaaaa', points: points(0.02) }], memory: [] }
    usageError = new ClusterError('forbidden', 403)
    const body = (await get(id)).body as { services: unknown[]; usageStatus: string; series: { status: string } }
    expect(body.usageStatus).toBe('not_collected')
    expect(body.services).toMatchObject([{ name: 'fe', restarts: 2, usage: null }])
    expect(body.series.status).toBe('collected')
  })

  it('says "not_collected" for the whole series when either query fails, and still gives the current values', async () => {
    const id = liveDeploy()
    deployments = [dep('fe-a')]
    pods = [pod('fe-a-6d9f8c7b5-aaaaa')]
    usage = [{ name: 'fe-a-6d9f8c7b5-aaaaa', containers: [{ cpu: '5m', memory: '1Mi' }] }]
    seriesError = new ClusterError('unexpected', 200)
    const body = (await get(id)).body as { services: { usage: unknown }[]; usageStatus: string; series: { endT: number } }
    expect(body.series).toEqual({ status: 'not_collected', endT: body.series.endT, windowSeconds: 3600, stepSeconds: 60, services: [] })
    expect(typeof body.series.endT).toBe('number')
    expect(body.usageStatus).toBe('collected')
    expect(body.services[0].usage).toEqual({ cpuMillicores: 5, memoryBytes: 1024 ** 2 })
  })

  it.each([new ClusterError('unreachable'), new ClusterError('forbidden', 403)])('answers 503 CLUSTER_UNAVAILABLE without telling the student why when the Deployment list cannot be read (%s)', async (error) => {
    const id = liveDeploy()
    listError = error
    const res = await get(id)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('CLUSTER_UNAVAILABLE'))
  })

  it('answers 503 DATABASE_UNAVAILABLE when the database does not answer', async () => {
    const id = liveDeploy()
    fetchMock.mockImplementation((input) => {
      const url = urlOf(input)
      if (url === JWKS_URL) return Promise.resolve(Response.json(keySet))
      return Promise.resolve(new Response('down', { status: 500 }))
    })
    const res = await get(id)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('DATABASE_UNAVAILABLE'))
  })
})
