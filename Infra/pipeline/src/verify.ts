import http from 'node:http'
import { byRole, ofSlot } from './apply.js'
import type { Clock } from './build.js'
import type { DeployInput, Service, Slot } from './deploy-input.js'
import { clusterFailure, platformRefusal, type StageFailure, stripManaged } from './failure.js'
import { type KubeCall, KubeRefused, listItems, listPath } from './kube.js'

// Verify(W6, 리더 실행기): 대상 슬롯의 Pod Ready · Service 엔드포인트를 보고, 공개 서비스는 test Ingress를 거쳐 Traefik에
// Host `<slug>.test.internal`로 그 서비스에 있는 경로만 요청한다. 검사한 항목이 모두 통과해야 통과다.
// 설계: docs/design/deploy-workflow.md §2 W6 · §4 "동작 확인과 전환" · "제한 시간". 결과 모양은 docs/design/api.md MCP 도구 `run_verify`와 같다.
// 학생 실패는 티켓 `raw.k8s`(그 서비스의 Pod와 대상 슬롯 이벤트, status null)와 통과하지 못한 검사 하나를 적은 errorMessage로 남긴다.

/** Traefik 요청 하나의 제한 시간, 다시 시도 간격과 횟수 */
export const REQUEST_TIMEOUT_MS = 10_000
export const RETRY_MS = 5000
export const TRIES = 3
/** 정적 페이지에서 같이 받아 보는 같은 호스트 파일 수의 상한 */
export const MAX_ASSETS = 10

export interface HttpAnswer {
  status: number
  body: string
}

/** Traefik에 `GET path`(Host 헤더 `host`). 제한 시간 안에 답이 없으면 TraefikError('timeout'), 닿지 못하면 TraefikError('unreachable'). */
export type HttpGet = (path: string, host: string) => Promise<HttpAnswer>

export class TraefikError extends Error {
  constructor(
    readonly kind: 'timeout' | 'unreachable',
    message: string,
  ) {
    super(message)
  }
}

/** 실행기 Pod(공간 `deploy`)에서 Traefik Service로. 학생 Pod에서는 막힌 길이다(cluster.md §7). */
export const DEFAULT_TRAEFIK_URL = 'http://traefik.kube-system:80'

export function traefikFromEnv(env: NodeJS.ProcessEnv): URL {
  const raw = env.TRAEFIK_URL ?? DEFAULT_TRAEFIK_URL
  const url = URL.parse(raw)
  if (!url || url.protocol !== 'http:' || url.pathname !== '/' || url.search) throw new Error('TRAEFIK_URL must look like http://traefik.kube-system:80')
  return url
}

// 페이지 HTML에서 파일 주소를 읽을 만큼만 받는다. 파일(js · css)은 상태만 보고 본문은 버린다.
const MAX_BODY = 1024 * 1024

export function makeHttpGet(base: URL, timeoutMs = REQUEST_TIMEOUT_MS): HttpGet {
  return (path, host) =>
    new Promise((resolve, reject) => {
      const options = { method: 'GET', path, host: base.hostname.replace(/^\[|\]$/g, ''), port: base.port, headers: { Host: host, Accept: '*/*' }, signal: AbortSignal.timeout(timeoutMs) }
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          if (size < MAX_BODY) chunks.push(c)
          size += c.length
        })
        res.on('error', (err) => reject(httpError(err, path, timeoutMs)))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8').slice(0, MAX_BODY) }))
      })
      req.on('error', (err) => reject(httpError(err, path, timeoutMs)))
      req.end()
    })
}

function httpError(err: Error, path: string, timeoutMs: number): TraefikError {
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return new TraefikError('timeout', `GET ${path} did not answer in ${timeoutMs / 1000}s`)
  const { code } = err as Error & { code?: unknown }
  return new TraefikError('unreachable', `GET ${path} could not reach Traefik: ${typeof code === 'string' ? code : err.name}`)
}

type Obj = Record<string, unknown>
const isRecord = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isRecord) : [])

/** Pod의 Ready 조건(readinessProbe 통과)이 True인가. */
export const podReady = (pod: Obj) => arr(isRecord(pod.status) ? pod.status.conditions : undefined).some((c) => c.type === 'Ready' && c.status === 'True')

/** Ready가 아닌 이유 한 마디: Pod가 없음, 컨테이너의 대기 이유(`CrashLoopBackOff` 등), 아니면 Ready 조건의 reason. */
export function notReadyReason(pods: Obj[]): string {
  const pod = pods.find((p) => !podReady(p))
  if (!pod) return 'no Pod'
  const status = isRecord(pod.status) ? pod.status : {}
  for (const c of [...arr(status.initContainerStatuses), ...arr(status.containerStatuses)]) {
    const reason = isRecord(c.state) && isRecord(c.state.waiting) ? c.state.waiting.reason : undefined
    if (typeof reason === 'string') return reason
  }
  const ready = arr(status.conditions).find((c) => c.type === 'Ready')
  return typeof ready?.reason === 'string' ? ready.reason : 'Ready is not True'
}

/** EndpointSlice들에 ready인 주소가 하나라도 있는가. */
export const hasReadyEndpoint = (slices: Obj[]) =>
  slices.some((s) => arr(s.endpoints).some((e) => (!isRecord(e.conditions) || e.conditions.ready !== false) && Array.isArray(e.addresses) && e.addresses.length > 0))

/**
 * 서비스 하나에서 Traefik으로 요청할 경로. null이면 요청하지 않고 Ready만 본다(내부 전용 · tcp · 닿지 않는 헬스체크 경로).
 * static은 `ingressPath` 페이지, server http는 헬스체크 경로(stripPrefix면 `ingressPath` + `health.path`).
 */
export function requestPath(svc: Service): { path: string; kind: 'page' | 'health' } | null {
  const { ingressPath, kind, health, stripPrefix } = svc.runtime
  if (ingressPath === null) return null
  if (kind === 'static') return { path: ingressPath, kind: 'page' }
  if (health.type !== 'http' || health.path === null) return null
  if (stripPrefix) return { path: `${ingressPath.replace(/\/+$/, '')}${health.path}`, kind: 'health' }
  const under = ingressPath === '/' || health.path === ingressPath || health.path.startsWith(`${ingressPath.replace(/\/+$/, '')}/`)
  return under ? { path: health.path, kind: 'health' } : null
}

/** 페이지 HTML의 `<script src>` · `<link rel="stylesheet" href>` 중 같은 호스트 파일의 경로(쿼리 포함), 앞에서부터 최대 10개. */
export function assetPaths(html: string, pagePath: string, host: string): string[] {
  const refs: string[] = []
  for (const m of html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) refs.push(m[1])
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']?stylesheet\b/i.test(m[0])) continue
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0])
    if (href) refs.push(href[1])
  }
  const page = new URL(pagePath, `http://${host}`)
  const paths: string[] = []
  for (const ref of refs) {
    const url = URL.parse(ref, page)
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.host !== host) continue
    const path = `${url.pathname}${url.search}`
    if (!paths.includes(path)) paths.push(path)
  }
  return paths.slice(0, MAX_ASSETS)
}

export interface ReadyCheck {
  service: string
  ready: boolean
}

export interface RequestCheck {
  service: string
  path: string
  status: number | null
  ms: number | null
  error: string | null
}

export interface VerifyReport {
  ok: boolean
  slot: Slot
  ready: ReadyCheck[]
  requests: RequestCheck[]
  failure: StageFailure | null
}

/** 대상 슬롯을 확인한다. Ready가 아닌 서비스가 있으면 요청하지 않는다. 요청은 처음 통과하지 못한 것에서 멈춘다. */
export async function runVerify(input: DeployInput, slot: Slot, call: KubeCall, get: HttpGet, clock: Clock): Promise<VerifyReport> {
  const namespace = `proj-${input.spec.project.slug}`
  const host = `${input.spec.project.slug}.test.internal`
  const services = byRole(input.spec.services)
  const fullNames = services.map((s) => `${s.name}-${slot}`)
  const ready: ReadyCheck[] = []
  const requests: RequestCheck[] = []
  const report = (failure: StageFailure | null): VerifyReport => ({ ok: failure === null, slot, ready, requests, failure })

  const podsOf = (svc: Service) => listItems(call, listPath('/api/v1', 'pods', namespace, `app=${svc.name},slot=${slot}`))
  // 학생 실패: 그 서비스의 Pod 하나(Ready가 아닌 것 먼저)와 대상 슬롯 리소스의 이벤트 원본.
  const studentFailure = async (svc: Service, why: string): Promise<StageFailure> => {
    const pods = await podsOf(svc)
    const pod = pods.find((p) => !podReady(p)) ?? pods[0]
    const events = await listItems(call, listPath('/api/v1', 'events', namespace))
    return { kind: 'student', service: svc.name, errorMessage: `${svc.name}: ${why}`, raw: { pod: pod ? stripManaged(pod) : null, events: events.filter(ofSlot(fullNames)).map(stripManaged), status: null } }
  }

  let current: string | null = null
  try {
    // 1. 모든 서비스: Pod Ready와 Service 엔드포인트(BE → AI 같은 내부 연결도 이 Service로 간다).
    let notReady: { svc: Service; why: string } | null = null
    for (const svc of services) {
      current = svc.name
      const full = `${svc.name}-${slot}`
      const pods = await podsOf(svc)
      const podOk = pods.some(podReady)
      const endpointOk = podOk && hasReadyEndpoint(await listItems(call, listPath('/apis/discovery.k8s.io/v1', 'endpointslices', namespace, `kubernetes.io/service-name=${full}`)))
      ready.push({ service: svc.name, ready: podOk && endpointOk })
      notReady ??= !podOk ? { svc, why: `not ready (${notReadyReason(pods)})` } : !endpointOk ? { svc, why: 'no endpoints' } : null
    }
    if (notReady) {
      current = notReady.svc.name
      return report(await studentFailure(notReady.svc, notReady.why))
    }

    // 2. 공개 서비스: test Ingress를 거쳐 Traefik으로.
    for (const svc of services) {
      const target = requestPath(svc)
      if (!target) continue
      current = svc.name
      const page = await request(svc, target.path)
      if (page.check.status !== 200) return report(await studentFailure(svc, failedRequest(page.check)))
      if (target.kind !== 'page') continue
      for (const path of assetPaths(page.body, target.path, host)) {
        const asset = await request(svc, path)
        if (asset.check.status !== 200) return report(await studentFailure(svc, failedRequest(asset.check)))
      }
    }
  } catch (err) {
    if (err instanceof TraefikError) return report({ kind: 'platform', code: 'TRAEFIK_UNREACHABLE', service: current, message: err.message })
    if (err instanceof KubeRefused) {
      const platform = platformRefusal(err.status)
      return report({ kind: 'platform', code: platform?.code ?? 'UNEXPECTED_REFUSAL', service: current, message: err.message, detail: err.status })
    }
    return report(clusterFailure(err, current))
  }
  return report(null)

  // 200이 올 때까지 5초 간격으로 3번까지. 기록은 마지막 시도다. Traefik에 닿지 못하면 TraefikError를 그대로 던진다(플랫폼 문제).
  async function request(svc: Service, path: string): Promise<{ check: RequestCheck; body: string }> {
    let last: { check: RequestCheck; body: string } | null = null
    for (let i = 0; i < TRIES; i++) {
      if (i > 0) await clock.sleep(RETRY_MS)
      const started = clock.now()
      try {
        const answer = await get(path, host)
        last = { check: { service: svc.name, path, status: answer.status, ms: clock.now() - started, error: null }, body: answer.body }
      } catch (err) {
        if (!(err instanceof TraefikError) || err.kind !== 'timeout') throw err
        last = { check: { service: svc.name, path, status: null, ms: null, error: 'timeout' }, body: '' }
      }
      if (last.check.status === 200) break
    }
    requests.push(last!.check)
    return last!
  }
}

/** errorMessage의 검사 부분 `GET <경로> -> <상태>`(답이 없으면 `-> error: <원인>`). 에이전트의 case(V1 · V2)가 이 문구로 신호를 잡는다. */
const failedRequest = (c: RequestCheck) => `GET ${c.path} -> ${c.status === null ? `error: ${c.error}` : c.status}`
