import { readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import type { RenderTools } from './render.js'

// 리더 k3s API를 실행기 계정 토큰으로 직접 부른다. kubectl을 쓰지 않는 이유: kubectl은 실패하면 "Error from server (...)" 문장만 내서,
// AI 에이전트에 넘길 k3s Status 원본(티켓 raw.k8s.status)이 남지 않는다. API의 답 본문은 그 Status 그대로다.
// 연결은 node:https다: API 인증서는 클러스터 자체 CA가 서명했고, 전역 fetch는 요청마다 CA를 줄 수 없다. 인증서 검증은 끄지 않는다.
// 토큰은 KUBE_API_URL로만 보내고 로그 · 오류에 남기지 않는다.

export interface KubeConn {
  url: URL
  token: string
  ca: string
}

/** API 호출 하나의 답. 본문은 원문 그대로다. */
export interface KubeAnswer {
  status: number
  body: string
}

export type KubeCall = (method: 'GET' | 'PATCH' | 'DELETE', path: string, body?: string, contentType?: string) => Promise<KubeAnswer>

/** API에 닿지 못했다(시간 초과 · 연결 실패 · 인증서 검증 실패). 플랫폼 문제다. */
export class KubeError extends Error {
  constructor(
    readonly code: 'K8S_TIMEOUT' | 'K8S_UNREACHABLE',
    message: string,
  ) {
    super(message)
  }
}

// 호출 하나의 상한. dry-run · 적용은 보통 1초 안이다. 사설망이 반쯤 끊겨 멈추면 GoCD job 제한(30분)까지 가지 않게 끊는다.
export const CALL_TIMEOUT_MS = 10_000

export const LOOPBACK = ['localhost', '127.0.0.1', '[::1]']

/**
 * 실행기 env에서 접속 정보를 읽는다: KUBE_API_URL(`https://<리더>:6443`), KUBE_TOKEN_FILE(실행기 ServiceAccount 토큰 파일),
 * KUBE_CA_FILE(클러스터 CA). 값은 파일 경로로만 받아 env · 로그에 토큰이 남지 않게 한다. http는 로컬 시험(loopback)만 된다.
 */
export function kubeFromEnv(env: NodeJS.ProcessEnv, read: (path: string) => string = (p) => readFileSync(p, 'utf8')): KubeConn {
  const raw = env.KUBE_API_URL
  const url = raw ? URL.parse(raw) : null
  if (!url || url.pathname !== '/' || url.search || !(url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.includes(url.hostname)))) {
    throw new Error('KUBE_API_URL must look like https://<leader>:6443')
  }
  if (!env.KUBE_TOKEN_FILE || !env.KUBE_CA_FILE) throw new Error('KUBE_TOKEN_FILE and KUBE_CA_FILE are required')
  const token = read(env.KUBE_TOKEN_FILE).trim()
  // 붙여 넣다 생긴 공백 · 줄바꿈이 헤더로 나가지 않게 한다. 값은 메시지에 싣지 않는다.
  if (!/^\S+$/.test(token)) throw new Error('KUBE_TOKEN_FILE must hold one token')
  return { url, token, ca: read(env.KUBE_CA_FILE) }
}

export function makeKube({ url, token, ca }: KubeConn, timeoutMs = CALL_TIMEOUT_MS): KubeCall {
  return (method, path, body, contentType = 'application/json') =>
    new Promise((resolve, reject) => {
      const headers: Record<string, string | number> = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
      if (body !== undefined) Object.assign(headers, { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) })
      // URL.hostname은 IPv6 주소에 대괄호를 남긴다. 연결 쪽은 대괄호 없는 주소를 받는다.
      const options = { method, path, headers, host: url.hostname.replace(/^\[|\]$/g, ''), port: url.port, ca, signal: AbortSignal.timeout(timeoutMs) }
      const onResponse = (res: http.IncomingMessage) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('error', (err) => reject(transportError(err, method, path, timeoutMs)))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
      }
      const req = (url.protocol === 'https:' ? https : http).request(options, onResponse)
      req.on('error', (err) => reject(transportError(err, method, path, timeoutMs)))
      req.end(body)
    })
}

// 오류 메시지에는 리더의 주소가 들어 있어 코드(ECONNREFUSED · 인증서 오류 이름 등)만 남긴다.
function transportError(err: Error, method: string, path: string, timeoutMs: number): KubeError {
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return new KubeError('K8S_TIMEOUT', `${method} ${path} did not answer in ${timeoutMs / 1000}s`)
  const { code } = err as Error & { code?: unknown }
  return new KubeError('K8S_UNREACHABLE', `${method} ${path} failed: ${typeof code === 'string' ? code : err.name}`)
}

/** 차트가 만드는 종류의 API 경로(`/api/v1` 등)와 복수형 이름. 다른 종류는 차트 버그다. */
const RESOURCES: Record<string, { base: string; plural: string }> = {
  'v1/ConfigMap': { base: '/api/v1', plural: 'configmaps' },
  'v1/Service': { base: '/api/v1', plural: 'services' },
  'apps/v1/Deployment': { base: '/apis/apps/v1', plural: 'deployments' },
  'networking.k8s.io/v1/Ingress': { base: '/apis/networking.k8s.io/v1', plural: 'ingresses' },
  'traefik.io/v1alpha1/Middleware': { base: '/apis/traefik.io/v1alpha1', plural: 'middlewares' },
}

export interface ManifestDoc {
  kind: string
  name: string
  /** server-side apply로 그대로 보내는 YAML 문서 하나 */
  text: string
  /** 그 객체의 API 경로(쿼리 없음) */
  path: string
}

/**
 * `helm template` 출력(student-app 차트)을 객체 하나씩으로 나눈다. YAML 라이브러리 없이 읽을 수 있는 것은 이 차트가 만드는 모양이기 때문이다:
 * 문서는 `---` 줄로 나뉘고, 최상위 `apiVersion:` · `kind:`가 있고 `metadata:` 다음 줄이 `  name:`이다. 본문은 YAML 그대로 보낸다(API가 YAML을 받는다).
 */
export function splitManifest(manifest: string, namespace: string): ManifestDoc[] {
  return manifest
    .split(/^---$/m)
    .filter((text) => /^kind:/m.test(text))
    .map((text) => {
      const apiVersion = /^apiVersion: (\S+)$/m.exec(text)?.[1]
      const kind = /^kind: (\S+)$/m.exec(text)?.[1]
      const name = /^metadata:\n {2}name: ([a-z0-9-]+)$/m.exec(text)?.[1]
      const resource = RESOURCES[`${apiVersion}/${kind}`]
      if (!kind || !name || !resource) throw new Error(`manifest has an object the pipeline cannot apply: ${apiVersion ?? '?'} ${kind ?? '?'} ${name ?? '?'}`)
      return { kind, name, text, path: `${resource.base}/namespaces/${namespace}/${resource.plural}/${name}` }
    })
}

/** server-side apply. `dryRun`이면 API가 검사만 하고 저장하지 않는다. 같은 필드를 다른 관리자가 가졌어도 이 차트 값으로 가져온다(force). */
export const applyQuery = (dryRun: boolean) => `?fieldManager=student-app&force=true${dryRun ? '&dryRun=All' : ''}`

/**
 * manifest의 객체를 하나씩 server-side apply dry-run으로 보낸다. 처음 거절된 객체에서 멈추고, API의 답(Status)을 원본 그대로 넘긴다.
 * 닿지 못하면 KubeError를 던진다(플랫폼 문제).
 */
export function makeServerDryRun(call: KubeCall): RenderTools['dryRun'] {
  return async (manifest, namespace) => {
    for (const doc of splitManifest(manifest, namespace)) {
      const answer = await call('PATCH', `${doc.path}${applyQuery(true)}`, doc.text, 'application/apply-patch+yaml')
      if (answer.status >= 200 && answer.status < 300) continue
      const status = parseJson(answer.body)
      const message = isRecord(status) && typeof status.message === 'string' ? status.message : `${doc.kind} ${doc.name}: API answered ${answer.status}`
      return { ok: false, status: status ?? null, message }
    }
    return { ok: true }
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** k3s가 2xx가 아닌 답을 했다. `status`는 답 본문(Status JSON, 못 읽으면 null)이다. */
export class KubeRefused extends Error {
  constructor(
    readonly httpStatus: number,
    readonly status: unknown,
  ) {
    super(isRecord(status) && typeof status.message === 'string' ? status.message : `API answered ${httpStatus}`)
  }
}

/** GET해서 JSON으로. 2xx가 아니면 KubeRefused, 닿지 못하면 KubeError. */
export async function getJson(call: KubeCall, path: string): Promise<Record<string, unknown>> {
  const answer = await call('GET', path)
  const body = parseJson(answer.body)
  if (answer.status < 200 || answer.status >= 300) throw new KubeRefused(answer.status, body ?? null)
  if (!isRecord(body)) throw new KubeRefused(answer.status, null)
  return body
}

/** 목록 API의 `items`. */
export async function listItems(call: KubeCall, path: string): Promise<Record<string, unknown>[]> {
  const body = await getJson(call, path)
  return Array.isArray(body.items) ? (body.items as unknown[]).filter(isRecord) : []
}

/** 객체 하나를 지운다. 이미 없으면(404) 지운 것으로 본다. 딸린 객체(ReplicaSet · Pod)는 쿠버네티스가 뒤에서 지운다. */
export async function deleteObject(call: KubeCall, path: string): Promise<void> {
  const answer = await call('DELETE', path)
  if (answer.status === 404 || (answer.status >= 200 && answer.status < 300)) return
  throw new KubeRefused(answer.status, parseJson(answer.body) ?? null)
}

/** manifest 문서 하나를 server-side apply한다(저장한다). 거절이면 KubeRefused. */
export async function applyDoc(call: KubeCall, doc: ManifestDoc): Promise<void> {
  const answer = await call('PATCH', `${doc.path}${applyQuery(false)}`, doc.text, 'application/apply-patch+yaml')
  if (answer.status >= 200 && answer.status < 300) return
  throw new KubeRefused(answer.status, parseJson(answer.body) ?? null)
}

/** 목록 경로. `labelSelector`는 인코딩해 붙인다. */
export const listPath = (base: string, plural: string, namespace: string, labelSelector?: string) =>
  `${base}/namespaces/${namespace}/${plural}${labelSelector ? `?labelSelector=${encodeURIComponent(labelSelector)}` : ''}`
