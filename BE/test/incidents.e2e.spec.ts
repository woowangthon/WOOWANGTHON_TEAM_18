import { randomUUID } from 'node:crypto'
import { type INestApplication, Logger } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeploysStore } from '../src/deploys/deploys.store.js'
import { AlertWatcher } from '../src/incidents/alert-watcher.js'
import { ClusterError } from '../src/k8s/cluster-error.js'
import { type AlertInfo, ClusterReader, type DeploymentInfo, type PodInfo } from '../src/k8s/cluster-reader.js'
import { DeploymentScaler } from '../src/k8s/deployment-scaler.js'
import { errorBody, JWKS_URL, keySet, token } from './auth-helpers.js'
import { startApp } from './start-app.js'

const REST = 'https://test.supabase.co/rest/v1/'
const AI = 'https://ai.test/agent/incidents'
const OPERATOR_HOOK = 'https://discord.com/api/webhooks/111/operator-token'
const STUDENT_HOOK = 'https://discord.com/api/webhooks/222/student-tok_wxyz'
const ADMIN = '99999999-9999-4999-8999-999999999999'
const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

type Row = Record<string, unknown>
let db: Record<string, Row[]>
let alerts: AlertInfo[]
let alertsError: Error | undefined
let deployments: Record<string, DeploymentInfo[]>
let pods: Record<string, PodInfo[]>
let scaled: { slug: string; name: string }[]
let aiAnswer: () => Response
let aiGate: Promise<void> | undefined
let discord: { url: string; content: string; mentions: unknown }[]
let aiBodies: Row[]
let discordDown: boolean
let scaleFails: Set<string>
let incidentsDown: boolean
let app: INestApplication<App>

const reader = {
  alerts: () => (alertsError ? Promise.reject(alertsError) : Promise.resolve(alerts)),
  deployments: (slug: string) => Promise.resolve(deployments[slug] ?? []),
  pods: (slug: string) => Promise.resolve(pods[slug] ?? []),
  logs: () => Promise.resolve('booting\nError: listen EADDRINUSE :::3000\nDB_PASSWORD=hunter2\n'),
}
const scaler: Pick<DeploymentScaler, 'scaleToZero'> = {
  scaleToZero(slug, name) {
    if (scaleFails.has(name)) return Promise.reject(new ClusterError('forbidden', 403))
    scaled.push({ slug, name })
    return Promise.resolve()
  },
}

// PostgREST 흉내: eq · is.null · in.() · or=(resolved_at.is.null,created_at.gte.T)만 안다.
function matches(row: Row, params: URLSearchParams): boolean {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue
    if (k === 'or') {
      const since = /created_at\.gte\.(.+)\)$/.exec(v)![1]
      if (!(row.resolved_at == null || String(row.created_at) >= since)) return false
    } else if (k === 'ai->>status') {
      if ((row.ai as Row).status !== v.slice(3)) return false
    } else if (v === 'is.null') {
      if (row[k] != null) return false
    } else if (v.startsWith('in.(')) {
      if (!v.slice(4, -1).split(',').includes(String(row[k]))) return false
    } else if (v.startsWith('eq.')) {
      if (String(row[k]) !== v.slice(3)) return false
    }
  }
  return true
}
function rest(url: URL, init: RequestInit | undefined): Response {
  const table = url.pathname.split('/').pop()!
  const method = init?.method ?? 'GET'
  if (incidentsDown && table === 'incidents') return Response.json({}, { status: 500 })
  const rows = (db[table] ??= [])
  const body = init?.body ? (JSON.parse(init.body as string) as Row) : {}
  if (method === 'POST') {
    if (table === 'incidents') {
      if (rows.some((r) => r.resolved_at == null && r.slug === body.slug && r.alertname === body.alertname)) return Response.json({ code: '23505' }, { status: 409 })
      const row = { id: randomUUID(), resolved_at: null, decided_by: null, decided_at: null, created_at: new Date().toISOString(), ...body }
      rows.push(row)
      return Response.json([row], { status: 201 })
    }
    const at = rows.findIndex((r) => r.user_id === body.user_id)
    if (at >= 0) rows.splice(at, 1)
    rows.push(body)
    return Response.json([body], { status: 201 })
  }
  const hit = rows.filter((r) => matches(r, url.searchParams))
  if (method === 'PATCH') {
    for (const r of hit) Object.assign(r, body)
    return Response.json(hit)
  }
  if (method === 'DELETE') {
    db[table] = rows.filter((r) => !hit.includes(r))
    return Response.json(hit)
  }
  const sorted = url.searchParams.get('order') === 'created_at.desc' ? [...hit].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) : hit
  return Response.json(sorted.slice(0, Number(url.searchParams.get('limit') ?? sorted.length)))
}
const urlOf = (i: string | URL | Request) => (i instanceof Request ? i.url : i.toString())
const fetchMock = vi.fn<typeof fetch>((input, init) => {
  const url = urlOf(input)
  if (url === JWKS_URL) return Promise.resolve(Response.json(keySet))
  if (url.startsWith(REST)) return Promise.resolve().then(() => rest(new URL(url), init))
  if (url === AI) {
    aiBodies.push(JSON.parse(init?.body as string) as Row)
    return (aiGate ?? Promise.resolve()).then(() => aiAnswer())
  }
  if (url.startsWith('https://discord.com/api/webhooks/')) {
    if (discordDown) return Promise.reject(new Error('down'))
    const sent = JSON.parse(init?.body as string) as { content: string; allowed_mentions: unknown }
    discord.push({ url, content: sent.content, mentions: sent.allowed_mentions })
    return Promise.resolve(new Response(null, { status: 204 }))
  }
  return Promise.reject(new Error(`unexpected fetch ${url}`))
})

const alert = (alertname: string, namespace: string | undefined, over: Partial<AlertInfo> = {}): AlertInfo => ({
  labels: { alertname, ...(namespace ? { namespace } : {}), pod: 'be-a-1', instance: '10.0.0.1:8080' },
  state: 'firing',
  activeAt: '2026-11-14T10:00:00Z',
  summary: `${alertname} summary`,
  ...over,
})
const deployment = (name: string): DeploymentInfo => ({ name, labels: {}, replicas: 1, ready: 0, updated: 1, available: 0 })
const pod = (name: string, restarts: number): PodInfo => ({ name, labels: {}, phase: 'Running', node: 'w1', ready: false, restarts, waiting: 'CrashLoopBackOff', lastExit: { reason: 'Error', exitCode: 1 } })
const seedProject = (slug: string, userId = USER) =>
  (db.deploys ??= []).push({ id: randomUUID(), user_id: userId, slug, repo: `S/${slug}`, commit_sha: 'a'.repeat(40), spec: {}, created_at: new Date().toISOString() })
const judgment = { risk: 'high', recommendation: 'stop', cause: '포트가 겹쳐 시작하지 못합니다.', reason: '로그에 EADDRINUSE가 있습니다.', model: 'local' }

async function check() {
  const watcher = app.get(AlertWatcher)
  watcher.kick()
  await watcher.idle()
}
const adminAuth = async () => `Bearer ${await token({ sub: ADMIN, email: 'op@example.com', app_metadata: { role: 'admin' } })}`
const userAuth = async (sub = USER) => `Bearer ${await token({ sub, app_metadata: { role: 'student' } })}`
const call = (method: 'get' | 'post' | 'put', path: string, auth: string, body?: object) => {
  const req = request(app.getHttpServer())[method](path).set({ Authorization: auth })
  return body === undefined ? req : req.send(body)
}

beforeEach(async () => {
  db = {}
  alerts = []
  alertsError = undefined
  deployments = {}
  pods = {}
  scaled = []
  discord = []
  aiBodies = []
  discordDown = false
  scaleFails = new Set()
  incidentsDown = false
  aiAnswer = () => Response.json(judgment)
  aiGate = undefined
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  app = await startApp([], (b) => b.overrideProvider(ClusterReader).useValue(reader).overrideProvider(DeploymentScaler).useValue(scaler))
})

afterEach(async () => {
  await app.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('alert watcher', () => {
  it('auto-stops a crash-looping project with no deploy running, and tells the operator and the student', async () => {
    seedProject('my-app')
    db.user_webhooks = [{ user_id: USER, url: STUDENT_HOOK }]
    deployments['my-app'] = [deployment('be-a'), deployment('be-b')]
    alerts = [alert('KubePodCrashLooping', 'proj-my-app'), alert('KubePodCrashLooping', 'proj-my-app', { labels: { alertname: 'KubePodCrashLooping', namespace: 'proj-my-app', pod: 'be-a-2' } })]
    await check()
    expect(scaled).toEqual([{ slug: 'my-app', name: 'be-a' }, { slug: 'my-app', name: 'be-b' }])
    // 같은 프로젝트 · 같은 경고는 하나로 묶는다.
    expect(db.incidents).toHaveLength(1)
    expect(db.incidents[0]).toMatchObject({ slug: 'my-app', alertname: 'KubePodCrashLooping', action: 'auto_stopped', decided_by: 'rule', ai: { status: 'skipped' } })
    expect(aiBodies).toEqual([])
    expect(discord.map((d) => d.url).sort()).toEqual([OPERATOR_HOOK, STUDENT_HOOK])
    expect(discord.find((d) => d.url === STUDENT_HOOK)!.content).toContain('멈췄어요')
    expect(discord.every((d) => JSON.stringify(d.mentions) === '{"parse":[]}')).toBe(true)
  })

  it('keeps the evidence it read before stopping, with redacted logs, and shows it to the student', async () => {
    seedProject('my-app')
    deployments['my-app'] = [deployment('be-a')]
    pods['my-app'] = [pod('be-a-1', 4)]
    alerts = [alert('KubePodCrashLooping', 'proj-my-app', { labels: { alertname: 'KubePodCrashLooping', namespace: 'proj-my-app', pod: 'be-a-1' } })]
    let scaledWhenRead = -1
    vi.spyOn(reader, 'logs').mockImplementation(() => {
      scaledWhenRead = scaled.length
      return Promise.resolve('booting\nError: listen EADDRINUSE :::3000\nDB_PASSWORD=hunter2\n')
    })
    await check()
    // 멈추면 Pod와 로그가 사라지므로 멈추기 전에 읽는다.
    expect(scaledWhenRead).toBe(0)
    expect(db.incidents[0]).toMatchObject({ action: 'auto_stopped', evidence: { pod: 'be-a-1', restarts: 4, waiting: 'CrashLoopBackOff', lastExit: { reason: 'Error', exitCode: 1 } } })
    const res = await call('get', '/api/incidents', await userAuth())
    const evidence = (res.body as { incidents: { evidence: { logs: string[] } }[] }).incidents[0].evidence
    expect(evidence.logs).toContain('Error: listen EADDRINUSE :::3000')
    expect(evidence.logs.join('\n')).not.toContain('hunter2')
  })

  it('does not overwrite the evidence of an incident processed again after the stop', async () => {
    seedProject('my-app')
    pods['my-app'] = [pod('be-a-1', 4)]
    alerts = [alert('KubePodNotReady', 'proj-my-app')]
    await check()
    const first = structuredClone(db.incidents[0].evidence)
    ;(db.incidents[0].ai as Row).status = 'pending'
    pods['my-app'] = [pod('be-a-2', 0)]
    await check()
    expect(db.incidents[0].evidence).toEqual(first)
  })

  it('leaves the evidence empty when it cannot read any pod', async () => {
    seedProject('my-app')
    alerts = [alert('KubePodNotReady', 'proj-my-app')]
    await check()
    expect(db.incidents[0].evidence ?? null).toBeNull()
  })

  it('does not stop a crash loop while a deploy of that project runs, and asks the AI instead', async () => {
    seedProject('my-app')
    db.deploy_runs = [{ deploy_id: randomUUID(), user_id: USER, slug: 'my-app', target_slot: 'b', input: {}, status: 'running', created_at: 'x', updated_at: 'x' }]
    deployments['my-app'] = [deployment('be-a')]
    alerts = [alert('KubePodCrashLooping', 'proj-my-app')]
    await check()
    expect(scaled).toEqual([])
    expect(db.incidents[0]).toMatchObject({ action: 'pending', ai: { status: 'done', recommendation: 'stop' } })
  })

  it('asks the AI about other alerts with redacted logs and never acts on its advice', async () => {
    seedProject('my-app')
    pods['my-app'] = [pod('be-a-1', 4), pod('be-a-9', 9)]
    alerts = [alert('KubePodNotReady', 'proj-my-app')]
    await check()
    expect(scaled).toEqual([])
    expect(aiBodies).toHaveLength(1)
    expect(aiBodies[0]).toMatchObject({ slug: 'my-app', alertname: 'KubePodNotReady', labels: { namespace: 'proj-my-app', pod: 'be-a-1' }, pods: [{ name: 'be-a-1', restarts: 4 }, { name: 'be-a-9' }] })
    expect(aiBodies[0].labels).not.toHaveProperty('instance')
    const logs = aiBodies[0].logs as string[]
    expect(logs).toContain('Error: listen EADDRINUSE :::3000')
    expect(logs.join('\n')).not.toContain('hunter2')
    expect(db.incidents[0]).toMatchObject({ action: 'pending', ai: { ...judgment, status: 'done' } })
    // 학생 웹후크가 없으면 운영자에게만 간다.
    expect(discord.map((d) => d.url)).toEqual([OPERATOR_HOOK])
    expect(discord[0].content).toContain('위험 높음 · 권고 중지')
  })

  it('marks the judgment failed when the AI server cannot answer, and still notifies', async () => {
    seedProject('my-app')
    aiAnswer = () => Response.json({ error: { code: 'MODEL_UNAVAILABLE' } }, { status: 503 })
    alerts = [alert('CPUThrottlingHigh', 'proj-my-app')]
    await check()
    expect(db.incidents[0]).toMatchObject({ action: 'pending', ai: { status: 'failed', risk: null } })
    expect(discord[0].content).toContain('AI 판단을 받지 못했어요')
  })

  it('opens an alert once, resolves it when it stops firing, and opens a new one if it fires again', async () => {
    seedProject('my-app')
    alerts = [alert('KubePodNotReady', 'proj-my-app')]
    await check()
    await check()
    expect(db.incidents).toHaveLength(1)
    expect(aiBodies).toHaveLength(1)
    alerts = []
    await check()
    expect(db.incidents[0].resolved_at).toEqual(expect.any(String))
    alerts = [alert('KubePodNotReady', 'proj-my-app')]
    await check()
    expect(db.incidents).toHaveLength(2)
  })

  it('keeps open incidents when the alerts cannot be read', async () => {
    seedProject('my-app')
    alerts = [alert('KubePodNotReady', 'proj-my-app')]
    await check()
    alertsError = new ClusterError('unreachable')
    await check()
    expect(db.incidents[0].resolved_at).toBeNull()
  })

  it('ignores pending alerts, the always-on alerts and namespaces that are not student projects', async () => {
    alerts = [
      alert('KubePodNotReady', 'proj-my-app', { state: 'pending' }),
      alert('Watchdog', undefined),
      alert('PrometheusRuleFailures', 'monitoring'),
      alert('KubePodCrashLooping', 'kube-system'),
      alert('KubePodNotReady', 'proj-Bad_Slug'),
    ]
    await check()
    expect(db.incidents ?? []).toEqual([])
    expect(discord).toEqual([])
  })

  it('sends a node alert to the operator only, once while it keeps firing', async () => {
    alerts = [alert('NodeFilesystemAlmostOutOfSpace', undefined)]
    await check()
    await check()
    expect(discord).toHaveLength(1)
    expect(discord[0]).toMatchObject({ url: OPERATOR_HOOK, content: expect.stringContaining('NodeFilesystemAlmostOutOfSpace') as string })
    expect(db.incidents ?? []).toEqual([])
    alerts = []
    await check()
    alerts = [alert('NodeFilesystemAlmostOutOfSpace', undefined)]
    await check()
    expect(discord).toHaveLength(2)
  })

  it('keeps watching when Discord fails', async () => {
    seedProject('my-app')
    discordDown = true
    alerts = [alert('NodeMemoryHighUtilization', undefined), alert('KubePodNotReady', 'proj-my-app')]
    await check()
    expect(db.incidents).toHaveLength(1)
    expect(db.incidents[0]).toMatchObject({ ai: { status: 'done' } })
  })
})

describe('alert watcher: partial failures', () => {
  it('sends node alerts even when the incidents table cannot be read', async () => {
    incidentsDown = true
    alerts = [alert('NodeFilesystemAlmostOutOfSpace', undefined)]
    await check()
    expect(discord.map((d) => d.url)).toEqual([OPERATOR_HOOK])
  })

  it('keeps retrying the auto-stop while only some Deployments went to 0', async () => {
    seedProject('my-app')
    deployments['my-app'] = [deployment('be-a'), deployment('fe-a')]
    scaleFails.add('fe-a')
    alerts = [alert('KubePodCrashLooping', 'proj-my-app')]
    await check()
    // 일부만 내렸으면 멈춤으로 기록하지 않고, AI에도 넘기지 않고, 알리지도 않는다.
    expect(db.incidents[0]).toMatchObject({ action: 'pending', ai: { status: 'pending' } })
    expect(aiBodies).toEqual([])
    expect(discord).toEqual([])
    scaleFails.clear()
    await check()
    expect(db.incidents[0]).toMatchObject({ action: 'auto_stopped' })
    expect(scaled.filter((s) => s.name === 'fe-a')).toHaveLength(1)
  })

  it('closes the other waiting incidents of the project it auto-stops, and sends one Discord message', async () => {
    seedProject('my-app')
    seedProject('other-app')
    deployments['my-app'] = [deployment('be-a')]
    alerts = [alert('KubePodNotReady', 'proj-my-app'), alert('KubePodNotReady', 'proj-other-app')]
    await check()
    discord = []
    alerts = [...alerts, alert('KubePodCrashLooping', 'proj-my-app')]
    await check()
    const byKey = (slug: string, name: string) => db.incidents.find((i) => i.slug === slug && i.alertname === name)!
    expect(byKey('my-app', 'KubePodCrashLooping')).toMatchObject({ action: 'auto_stopped', decided_by: 'rule' })
    expect(byKey('my-app', 'KubePodNotReady')).toMatchObject({ action: 'auto_stopped', decided_by: 'rule', ai: { status: 'skipped' } })
    expect(byKey('other-app', 'KubePodNotReady')).toMatchObject({ action: 'pending', decided_by: null })
    // 알림은 자동 중지한 경고 하나만(같이 닫힌 알림은 보내지 않는다).
    expect(discord).toHaveLength(1)
    expect(discord[0].content).toContain('(KubePodCrashLooping)')
  })

  it('asks the AI when no Deployment could be stopped', async () => {
    seedProject('my-app')
    deployments['my-app'] = [deployment('be-a')]
    scaleFails.add('be-a')
    alerts = [alert('KubePodCrashLooping', 'proj-my-app')]
    await check()
    expect(db.incidents[0]).toMatchObject({ action: 'pending', ai: { status: 'done' } })
  })

  it('finishes an incident that was saved but never processed (failure or restart)', async () => {
    seedProject('my-app')
    db.incidents = [
      { id: randomUUID(), slug: 'my-app', alertname: 'KubePodNotReady', labels: {}, summary: '', fired_at: new Date().toISOString(), resolved_at: null, action: 'pending', ai: { status: 'pending', risk: null, recommendation: null, cause: null, reason: null, model: null }, decided_by: null, decided_at: null, created_at: new Date().toISOString() },
    ]
    alerts = [alert('KubePodNotReady', 'proj-my-app')]
    await check()
    expect(db.incidents[0]).toMatchObject({ ai: { status: 'done' } })
    expect(discord).toHaveLength(1)
    // 끝난 알림은 다시 처리하지 않는다.
    await check()
    expect(aiBodies).toHaveLength(1)
  })
})

describe('operator incidents API', () => {
  async function seedIncident(action = 'pending') {
    seedProject('my-app')
    deployments['my-app'] = [deployment('be-a')]
    alerts = [alert('KubePodNotReady', 'proj-my-app')]
    await check()
    db.incidents[0].action = action
    return db.incidents[0].id as string
  }

  it('lists incidents with the open ones first', async () => {
    const id = await seedIncident('dismissed')
    alerts = [alert('KubePodNotReady', 'proj-my-app'), alert('CPUThrottlingHigh', 'proj-my-app')]
    await check()
    const res = await call('get', '/api/admin/incidents', await adminAuth())
    expect(res.status).toBe(200)
    const list = res.body as { incidents: { id: string; alertname: string; title: string; state: string; action: string; decidedBy: string | null }[] }
    expect(list.incidents.map((i) => i.alertname)).toEqual(['CPUThrottlingHigh', 'KubePodNotReady'])
    expect(list.incidents[1]).toMatchObject({ id, title: '서비스가 준비되지 않은 채로 있어요', state: 'firing', action: 'dismissed', decidedBy: null })
  })

  it('stops the project and records who decided', async () => {
    const id = await seedIncident()
    const res = await call('post', `/api/admin/incidents/${id}/stop`, await adminAuth())
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ incident: { id, action: 'stopped', decidedBy: 'op@example.com', decidedAt: expect.any(String) as string } })
    expect(scaled).toEqual([{ slug: 'my-app', name: 'be-a' }])
    // 이미 정한 것은 다시 정하지 않는다.
    expect((await call('post', `/api/admin/incidents/${id}/dismiss`, await adminAuth())).body).toEqual(errorBody('INCIDENT_CLOSED'))
  })

  it('closes every waiting incident of the project with one stop, leaving decided ones and other projects alone', async () => {
    seedProject('my-app')
    seedProject('other-app')
    deployments['my-app'] = [deployment('be-a')]
    alerts = [alert('KubePodNotReady', 'proj-my-app'), alert('CPUThrottlingHigh', 'proj-my-app'), alert('KubeContainerWaiting', 'proj-my-app'), alert('KubePodNotReady', 'proj-other-app')]
    await check()
    const byKey = (slug: string, name: string) => db.incidents.find((i) => i.slug === slug && i.alertname === name)!
    byKey('my-app', 'KubeContainerWaiting').action = 'dismissed'
    const id = byKey('my-app', 'KubePodNotReady').id as string
    const res = await call('post', `/api/admin/incidents/${id}/stop`, await adminAuth())
    expect(res.status).toBe(200)
    const decidedAt = byKey('my-app', 'KubePodNotReady').decided_at
    expect(byKey('my-app', 'CPUThrottlingHigh')).toMatchObject({ action: 'stopped', decided_by: 'op@example.com', decided_at: decidedAt })
    expect(byKey('my-app', 'KubeContainerWaiting')).toMatchObject({ action: 'dismissed', decided_by: null })
    expect(byKey('other-app', 'KubePodNotReady')).toMatchObject({ action: 'pending', decided_by: null })
    expect(scaled).toEqual([{ slug: 'my-app', name: 'be-a' }])
  })

  it('keeps a judgment that arrives after the stop, but does not send it to Discord', async () => {
    seedProject('my-app')
    deployments['my-app'] = [deployment('be-a')]
    let release = () => {}
    aiGate = new Promise((r) => (release = r))
    alerts = [alert('KubePodNotReady', 'proj-my-app'), alert('CPUThrottlingHigh', 'proj-my-app')]
    const watcher = app.get(AlertWatcher)
    watcher.kick()
    await vi.waitFor(() => expect(aiBodies).toHaveLength(2))
    const id = db.incidents[0].id as string
    expect((await call('post', `/api/admin/incidents/${id}/stop`, await adminAuth())).status).toBe(200)
    release()
    await watcher.idle()
    expect(db.incidents.map((i) => [i.action, (i.ai as Row).status])).toEqual([
      ['stopped', 'done'],
      ['stopped', 'done'],
    ])
    expect(discord).toEqual([])
  })

  it('leaves the other waiting incidents open when the cluster could not stop anything', async () => {
    seedProject('my-app')
    deployments['my-app'] = [deployment('be-a')]
    scaleFails.add('be-a')
    alerts = [alert('KubePodNotReady', 'proj-my-app'), alert('CPUThrottlingHigh', 'proj-my-app')]
    await check()
    const id = db.incidents[0].id as string
    expect((await call('post', `/api/admin/incidents/${id}/stop`, await adminAuth())).status).toBe(503)
    expect(db.incidents.map((i) => i.action)).toEqual(['pending', 'pending'])
  })

  it('keeps an open incident in the list even when 50 newer ones exist', async () => {
    const id = await seedIncident()
    db.incidents[0].created_at = '2026-01-01T00:00:00.000Z'
    for (let i = 0; i < 55; i++) db.incidents.push({ ...db.incidents[0], id: randomUUID(), alertname: `Old${i}`, action: 'dismissed', resolved_at: new Date().toISOString(), created_at: new Date().toISOString() })
    const res = await call('get', '/api/admin/incidents', await adminAuth())
    const list = res.body as { incidents: { id: string }[] }
    expect(list.incidents[0].id).toBe(id)
  })

  it('puts the decision back when the cluster could not stop everything', async () => {
    const id = await seedIncident()
    scaleFails.add('be-a')
    const res = await call('post', `/api/admin/incidents/${id}/stop`, await adminAuth())
    expect(res.status).toBe(503)
    expect(db.incidents[0]).toMatchObject({ action: 'pending', decided_by: null })
  })

  it('keeps the stop decision when only some Deployments went to 0, so it cannot become a dismissal', async () => {
    const id = await seedIncident()
    deployments['my-app'] = [deployment('be-a'), deployment('fe-a')]
    scaleFails.add('fe-a')
    const res = await call('post', `/api/admin/incidents/${id}/stop`, await adminAuth())
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('STOP_INCOMPLETE'))
    expect(db.incidents[0]).toMatchObject({ action: 'stopped', decided_by: 'op@example.com' })
    expect((await call('post', `/api/admin/incidents/${id}/dismiss`, await adminAuth())).body).toEqual(errorBody('INCIDENT_CLOSED'))
  })

  it('dismisses without touching the cluster', async () => {
    const id = await seedIncident()
    const res = await call('post', `/api/admin/incidents/${id}/dismiss`, await adminAuth())
    expect(res.body).toMatchObject({ incident: { action: 'dismissed' } })
    expect(scaled).toEqual([])
  })

  it('answers 404 for an unknown or malformed id, and refuses students', async () => {
    expect((await call('post', `/api/admin/incidents/${randomUUID()}/stop`, await adminAuth())).body).toEqual(errorBody('INCIDENT_NOT_FOUND'))
    expect((await call('post', '/api/admin/incidents/x/stop', await adminAuth())).status).toBe(404)
    for (const [method, path] of [['get', '/api/admin/incidents'], ['post', `/api/admin/incidents/${randomUUID()}/stop`]] as const) {
      expect((await call(method, path, await userAuth())).status).toBe(403)
    }
  })
})

describe('deploy result to the student Discord', () => {
  it('sends one line to the owner when a run fails, and nothing to the operator', async () => {
    const now = new Date().toISOString()
    db.deploy_runs = [{ deploy_id: 'd1', user_id: USER, slug: 'my-app', target_slot: 'b', input: {}, status: 'fixing', stage: 'apply', failure: null, created_at: now, updated_at: now }]
    db.user_webhooks = [{ user_id: USER, url: STUDENT_HOOK }]
    const applied = await app.get(DeploysStore).updateRun('d1', { status: 'fixing' }, { status: 'failed', failure: { code: 'AGENT_GAVE_UP', stage: 'apply', service: null } })
    expect(applied).toBe(true)
    await vi.waitFor(() => expect(discord).toHaveLength(1))
    expect(discord[0]).toMatchObject({ url: STUDENT_HOOK, mentions: { parse: [] } })
    expect(discord[0].content).toContain('[my-app] 배포하지 못했어요 (apply · AGENT_GAVE_UP).')
  })
})

describe('student incidents API', () => {
  it('shows only my projects: open alerts and recent stops, not dismissed ones', async () => {
    seedProject('my-app')
    seedProject('my-two')
    seedProject('their-app', OTHER)
    deployments['my-app'] = [deployment('be-a')]
    alerts = [alert('KubePodCrashLooping', 'proj-my-app'), alert('KubePodNotReady', 'proj-my-two'), alert('KubePodNotReady', 'proj-their-app'), alert('CPUThrottlingHigh', 'proj-my-two')]
    await check()
    db.incidents.find((i) => i.alertname === 'CPUThrottlingHigh')!.action = 'dismissed'
    const res = await call('get', '/api/incidents', await userAuth())
    expect(res.status).toBe(200)
    const got = (res.body as { incidents: { slug: string; alertname: string; action: string; decidedBy?: unknown }[] }).incidents
    expect(got.map((i) => `${i.slug} ${i.alertname} ${i.action}`).sort()).toEqual(['my-app KubePodCrashLooping auto_stopped', 'my-two KubePodNotReady pending'])
    expect(got[0]).not.toHaveProperty('decidedBy')
  })

  it('still finds a project when another project has many newer deploys', async () => {
    seedProject('my-app')
    db.deploys[0].created_at = '2026-01-01T00:00:00.000Z'
    for (let i = 0; i < 60; i++) seedProject('busy-app')
    alerts = [alert('KubePodNotReady', 'proj-my-app')]
    await check()
    const got = (await call('get', '/api/incidents', await userAuth())).body as { incidents: { slug: string }[] }
    expect(got.incidents.map((i) => i.slug)).toEqual(['my-app'])
  })

  it('is empty for a student with no project', async () => {
    expect((await call('get', '/api/incidents', await userAuth())).body).toEqual({ incidents: [] })
  })
})

describe('student Discord webhook', () => {
  it('saves a webhook and shows only its last 4 characters, then clears it', async () => {
    expect((await call('get', '/api/profile/discord-webhook', await userAuth())).body).toEqual({ set: false, hint: null })
    const put = await call('put', '/api/profile/discord-webhook', await userAuth(), { url: STUDENT_HOOK })
    expect(put.status).toBe(200)
    expect(put.body).toEqual({ set: true, hint: 'wxyz' })
    expect((await call('get', '/api/profile/discord-webhook', await userAuth())).body).toEqual({ set: true, hint: 'wxyz' })
    expect(JSON.stringify((await call('get', '/api/profile/discord-webhook', await userAuth())).body)).not.toContain('student-tok')
    expect((await call('put', '/api/profile/discord-webhook', await userAuth(), { url: null })).body).toEqual({ set: false, hint: null })
    expect(db.user_webhooks).toEqual([])
  })

  it.each([
    'https://evil.example/api/webhooks/1/abc',
    'http://discord.com/api/webhooks/1/abc',
    'https://discord.com/api/webhooks/1/abc?wait=true',
    '',
    42,
  ])('refuses %j with INVALID_WEBHOOK', async (url) => {
    const res = await call('put', '/api/profile/discord-webhook', await userAuth(), { url })
    expect(res.status).toBe(400)
    expect(res.body).toEqual(errorBody('INVALID_WEBHOOK'))
    expect(db.user_webhooks ?? []).toEqual([])
  })
})
