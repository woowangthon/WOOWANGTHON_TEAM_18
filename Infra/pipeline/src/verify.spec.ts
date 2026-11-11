import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeployInput, Service } from './deploy-input.js'
import { deployInput } from './fixtures.js'
import { KubeError } from './kube.js'
import { fakeKube, list, refused, type Route } from './kube-fake.js'
import {
  assetPaths,
  hasReadyEndpoint,
  type HttpAnswer,
  type HttpGet,
  makeHttpGet,
  podReady,
  requestPath,
  runVerify,
  TraefikError,
  traefikFromEnv,
} from './verify.js'

const NS = '/namespaces/proj-my-app'
const HOST = 'my-app.test.internal'

function fakeClock() {
  let t = 0
  return {
    sleep: vi.fn((ms: number) => {
      t += ms
      return Promise.resolve()
    }),
    now: () => t,
  }
}

const readyPod = (name: string) => ({ metadata: { name, managedFields: [{ manager: 'k3s' }] }, status: { conditions: [{ type: 'Ready', status: 'True' }] } })
const unreadyPod = (name: string) => ({ metadata: { name }, status: { conditions: [{ type: 'Ready', status: 'False' }] } })
const slice = (ready = true) => ({ endpoints: [{ addresses: ['10.42.1.5'], conditions: { ready } }] })

const pods = (svc: string) => `GET /api/v1${NS}/pods?labelSelector=app%3D${svc}%2Cslot%3Db`
const slices = (svc: string) => `GET /apis/discovery.k8s.io/v1${NS}/endpointslices?labelSelector=kubernetes.io%2Fservice-name%3D${svc}-b`
const events = `GET /api/v1${NS}/events`

// 세 서비스 모두 Ready, 엔드포인트 있음.
function cluster(over: Record<string, Route> = {}) {
  const routes: Record<string, Route> = { [events]: list() }
  for (const s of ['fe', 'be', 'ai']) {
    routes[pods(s)] = list(readyPod(`${s}-b-x-y`))
    routes[slices(s)] = list(slice())
  }
  return fakeKube({ ...routes, ...over })
}

const PAGE = '<html><head><script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css"></head></html>'

// 경로 → 답(또는 오류). 없는 경로는 404.
function traefik(routes: Record<string, HttpAnswer | TraefikError | (HttpAnswer | TraefikError)[]> = {}) {
  const all: typeof routes = { '/': { status: 200, body: PAGE }, '/assets/index.js': { status: 200, body: '' }, '/assets/index.css': { status: 200, body: '' }, '/api/health': { status: 200, body: 'ok' }, ...routes }
  const seen: Record<string, number> = {}
  const get = vi.fn<HttpGet>((path) => {
    const n = (seen[path] = (seen[path] ?? 0) + 1)
    const r = all[path]
    const answer = Array.isArray(r) ? r[Math.min(n, r.length) - 1] : (r ?? { status: 404, body: '' })
    return answer instanceof TraefikError ? Promise.reject(answer) : Promise.resolve(answer)
  })
  return get
}

const service = (over: Partial<Service['runtime']>): Service => {
  const be = deployInput().spec.services[1]
  return { ...be, runtime: { ...be.runtime, ...over } }
}

describe('requestPath', () => {
  it('asks a static service for its page', () => {
    expect(requestPath(deployInput().spec.services[0])).toEqual({ path: '/', kind: 'page' })
  })
  it('asks a server for its health path when that path is under ingressPath', () => {
    expect(requestPath(deployInput().spec.services[1])).toEqual({ path: '/api/health', kind: 'health' })
    expect(requestPath(service({ ingressPath: '/', health: { type: 'http', path: '/healthz', startupTimeoutSeconds: 5 } }))).toEqual({ path: '/healthz', kind: 'health' })
    expect(requestPath(service({ ingressPath: '/api', health: { type: 'http', path: '/api', startupTimeoutSeconds: 5 } }))).toEqual({ path: '/api', kind: 'health' })
  })
  it('puts ingressPath in front of the health path when the prefix is stripped', () => {
    expect(requestPath(service({ ingressPath: '/api', stripPrefix: true, health: { type: 'http', path: '/health', startupTimeoutSeconds: 5 } }))).toEqual({ path: '/api/health', kind: 'health' })
    expect(requestPath(service({ ingressPath: '/api/', stripPrefix: true, health: { type: 'http', path: '/health', startupTimeoutSeconds: 5 } }))).toEqual({ path: '/api/health', kind: 'health' })
  })
  it.each([
    ['an internal service', { ingressPath: null }],
    ['a tcp health check', { health: { type: 'tcp' as const, path: null, startupTimeoutSeconds: 5 } }],
    ['a health path Traefik cannot reach', { health: { type: 'http' as const, path: '/health', startupTimeoutSeconds: 5 } }],
    ['a health path that only shares a prefix', { health: { type: 'http' as const, path: '/apix/health', startupTimeoutSeconds: 5 } }],
  ])('asks nothing of %s (Ready only)', (_, over) => {
    expect(requestPath(service(over))).toBeNull()
  })
})

describe('assetPaths', () => {
  it('reads scripts and stylesheets of the same host, relative to the page, without duplicates', () => {
    const html = `
      <script src="/a.js"></script><script src='b.js?v=2'></script><script>inline()</script>
      <link href="/s.css" rel="stylesheet"><link rel=stylesheet href="./t.css"><link rel="icon" href="/favicon.ico">
      <script src="https://cdn.example.com/x.js"></script><script src="//${HOST}/c.js"></script><script src="/a.js"></script>`
    expect(assetPaths(html, '/app/', HOST)).toEqual(['/a.js', '/app/b.js?v=2', '/c.js', '/s.css', '/app/t.css'])
  })
  it('keeps at most 10', () => {
    const html = Array.from({ length: 12 }, (_, i) => `<script src="/f${i}.js"></script>`).join('')
    expect(assetPaths(html, '/', HOST)).toHaveLength(10)
  })
})

describe('podReady and hasReadyEndpoint', () => {
  it('wants the Ready condition True', () => {
    expect(podReady(readyPod('p'))).toBe(true)
    expect(podReady(unreadyPod('p'))).toBe(false)
    expect(podReady({})).toBe(false)
  })
  it('wants one ready address', () => {
    expect(hasReadyEndpoint([slice()])).toBe(true)
    expect(hasReadyEndpoint([{ endpoints: [{ addresses: ['10.0.0.1'] }] }])).toBe(true)
    expect(hasReadyEndpoint([slice(false)])).toBe(false)
    expect(hasReadyEndpoint([{ endpoints: [{ addresses: [] }] }, {}])).toBe(false)
    expect(hasReadyEndpoint([])).toBe(false)
  })
})

describe('runVerify', () => {
  const input = (): DeployInput => deployInput()

  it('passes when every service is Ready and every public path answers 200, in the run_verify shape', async () => {
    const { call } = cluster()
    const get = traefik()
    const report = await runVerify(input(), 'b', call, get, fakeClock())
    expect(report).toEqual({
      ok: true,
      slot: 'b',
      ready: [
        { service: 'ai', ready: true },
        { service: 'be', ready: true },
        { service: 'fe', ready: true },
      ],
      requests: [
        { service: 'be', path: '/api/health', status: 200, ms: 0, error: null },
        { service: 'fe', path: '/', status: 200, ms: 0, error: null },
        { service: 'fe', path: '/assets/index.js', status: 200, ms: 0, error: null },
        { service: 'fe', path: '/assets/index.css', status: 200, ms: 0, error: null },
      ],
      failure: null,
    })
    expect(get.mock.calls.every(([, host]) => host === HOST)).toBe(true)
  })

  it('fails a service with no Ready Pod before any request, with that Pod and the slot events', async () => {
    const slotEvent = { metadata: { name: 'e1', managedFields: [] }, involvedObject: { kind: 'Pod', name: 'be-b-x-y' }, reason: 'Unhealthy' }
    const other = { metadata: { name: 'e2' }, involvedObject: { kind: 'Pod', name: 'be-a-x-y' }, reason: 'Started' }
    const { call } = cluster({ [pods('be')]: list(unreadyPod('be-b-x-y')), [events]: list(slotEvent, other) })
    const get = traefik()
    const report = await runVerify(input(), 'b', call, get, fakeClock())
    expect(report.ok).toBe(false)
    expect(report.ready).toEqual([
      { service: 'ai', ready: true },
      { service: 'be', ready: false },
      { service: 'fe', ready: true },
    ])
    expect(report.requests).toEqual([])
    expect(report.failure).toEqual({
      kind: 'student',
      service: 'be',
      errorMessage: 'be-b: no Pod is Ready',
      raw: { pod: unreadyPod('be-b-x-y'), events: [{ metadata: { name: 'e1' }, involvedObject: slotEvent.involvedObject, reason: 'Unhealthy' }], status: null },
    })
    expect(get).not.toHaveBeenCalled()
  })

  it('fails a Service with no ready endpoints, with its Pod without managed fields', async () => {
    const { call } = cluster({ [slices('ai')]: list(slice(false)) })
    const report = await runVerify(input(), 'b', call, traefik(), fakeClock())
    expect(report.ready[0]).toEqual({ service: 'ai', ready: false })
    expect(report.failure).toEqual({ kind: 'student', service: 'ai', errorMessage: 'ai-b: Service ai-b has no ready endpoints', raw: { pod: { metadata: { name: 'ai-b-x-y' }, status: readyPod('x').status }, events: [], status: null } })
  })

  it('names the first service that is not Ready', async () => {
    const { call } = cluster({ [pods('ai')]: list(), [pods('fe')]: list() })
    const report = await runVerify(input(), 'b', call, traefik(), fakeClock())
    expect(report.failure).toMatchObject({ service: 'ai', errorMessage: 'ai-b: no Pod is Ready', raw: { pod: null } })
  })

  it('retries a failing path every 5 seconds, 3 times, and states the path and status (case V1: a static file 404)', async () => {
    const { call } = cluster()
    const clock = fakeClock()
    const get = traefik({ '/assets/index.js': { status: 404, body: 'not found' } })
    const report = await runVerify(input(), 'b', call, get, clock)
    expect(get.mock.calls.filter(([p]) => p === '/assets/index.js')).toHaveLength(3)
    expect(clock.sleep.mock.calls).toEqual([[5000], [5000]])
    expect(report.requests.at(-1)).toEqual({ service: 'fe', path: '/assets/index.js', status: 404, ms: 0, error: null })
    expect(report.failure).toMatchObject({ kind: 'student', service: 'fe', errorMessage: 'fe-b: GET /assets/index.js answered 404 (3 tries)', raw: { pod: { metadata: { name: 'fe-b-x-y' } }, status: null } })
    // 그 뒤 파일은 요청하지 않는다.
    expect(get.mock.calls.some(([p]) => p === '/assets/index.css')).toBe(false)
  })

  it('passes a path that answers 200 on a later try', async () => {
    const { call } = cluster()
    const clock = fakeClock()
    const get = traefik({ '/api/health': [{ status: 503, body: '' }, { status: 200, body: 'ok' }] })
    const report = await runVerify(input(), 'b', call, get, clock)
    expect(report.ok).toBe(true)
    expect(report.requests[0]).toEqual({ service: 'be', path: '/api/health', status: 200, ms: 0, error: null })
    expect(clock.sleep).toHaveBeenCalledTimes(1)
  })

  it('fails the API health path (case V2) before the page is asked for', async () => {
    const { call } = cluster()
    const get = traefik({ '/api/health': { status: 404, body: '' } })
    const report = await runVerify(input(), 'b', call, get, fakeClock())
    expect(report.failure).toMatchObject({ service: 'be', errorMessage: 'be-b: GET /api/health answered 404 (3 tries)' })
    expect(get.mock.calls.some(([p]) => p === '/')).toBe(false)
  })

  it('records a request that does not answer as a timeout and fails as a student problem', async () => {
    const { call } = cluster()
    const get = traefik({ '/': new TraefikError('timeout', 'GET / did not answer in 10s') })
    const report = await runVerify(input(), 'b', call, get, fakeClock())
    expect(report.requests.at(-1)).toEqual({ service: 'fe', path: '/', status: null, ms: null, error: 'timeout' })
    expect(report.failure).toMatchObject({ kind: 'student', service: 'fe', errorMessage: 'fe-b: GET / did not answer in 10s (3 tries)' })
  })

  it('reports an unreachable Traefik as a platform problem', async () => {
    const { call } = cluster()
    const get = traefik({ '/api/health': new TraefikError('unreachable', 'GET /api/health could not reach Traefik: ECONNREFUSED') })
    const report = await runVerify(input(), 'b', call, get, fakeClock())
    expect(report.failure).toEqual({ kind: 'platform', code: 'TRAEFIK_UNREACHABLE', service: 'be', message: 'GET /api/health could not reach Traefik: ECONNREFUSED' })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('checks only Ready when no service is public', async () => {
    const i = input()
    for (const s of i.spec.services) s.runtime.ingressPath = null
    const get = traefik()
    const report = await runVerify(i, 'b', cluster().call, get, fakeClock())
    expect(report).toMatchObject({ ok: true, requests: [] })
    expect(get).not.toHaveBeenCalled()
  })

  it('names the platform refusal (no executor permission)', async () => {
    const forbidden = { kind: 'Status', code: 403, message: 'endpointslices.discovery.k8s.io is forbidden: User "x" cannot list resource "endpointslices"' }
    const { call } = cluster({ [slices('ai')]: refused(403, forbidden) })
    const report = await runVerify(input(), 'b', call, traefik(), fakeClock())
    expect(report.failure).toEqual({ kind: 'platform', code: 'EXECUTOR_FORBIDDEN', service: 'ai', message: forbidden.message, detail: forbidden })
  })

  it('reports any other refusal as an unexpected platform refusal', async () => {
    const { call } = cluster({ [pods('ai')]: refused(500, { kind: 'Status', code: 500, message: 'etcd timeout' }) })
    const report = await runVerify(input(), 'b', call, traefik(), fakeClock())
    expect(report.failure).toMatchObject({ kind: 'platform', code: 'UNEXPECTED_REFUSAL', service: 'ai', message: 'etcd timeout' })
  })

  it('reports an unreachable API as a platform problem', async () => {
    const { call } = cluster({ [pods('ai')]: new KubeError('K8S_UNREACHABLE', 'GET pods failed: ECONNREFUSED') })
    const report = await runVerify(input(), 'b', call, traefik(), fakeClock())
    expect(report.failure).toEqual({ kind: 'platform', code: 'K8S_UNREACHABLE', service: 'ai', message: 'GET pods failed: ECONNREFUSED' })
  })
})

describe('traefikFromEnv', () => {
  it('defaults to the Traefik Service and takes an http address', () => {
    expect(traefikFromEnv({}).href).toBe('http://traefik.kube-system/')
    expect(traefikFromEnv({ TRAEFIK_URL: 'http://10.43.0.10:8000' }).href).toBe('http://10.43.0.10:8000/')
  })
  it.each(['https://traefik', 'http://traefik/x', 'http://traefik/?a=1', 'traefik'])('refuses %s', (v) => {
    expect(() => traefikFromEnv({ TRAEFIK_URL: v })).toThrow('TRAEFIK_URL')
  })
})

describe('makeHttpGet', () => {
  let server: http.Server | undefined
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())))

  const serve = (handler: http.RequestListener) =>
    new Promise<URL>((resolve) => {
      server = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(new URL(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`)))
    })

  it('sends the Host header and returns status and body', async () => {
    const base = await serve((req, res) => res.writeHead(201).end(`${req.headers.host} ${req.url}`))
    expect(await makeHttpGet(base)('/a?b=1', HOST)).toEqual({ status: 201, body: `${HOST} /a?b=1` })
  })
  it('times out as timeout', async () => {
    const base = await serve(() => undefined)
    await expect(makeHttpGet(base, 50)('/', HOST)).rejects.toMatchObject({ kind: 'timeout', message: 'GET / did not answer in 0.05s' })
    server!.closeAllConnections()
  })
  it('cannot connect as unreachable', async () => {
    const base = await serve(() => undefined)
    await new Promise<void>((done) => server!.close(() => done()))
    server = undefined
    await expect(makeHttpGet(base)('/', HOST)).rejects.toMatchObject({ kind: 'unreachable', message: 'GET / could not reach Traefik: ECONNREFUSED' })
  })
})
