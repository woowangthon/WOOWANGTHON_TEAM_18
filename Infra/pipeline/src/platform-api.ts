import { required } from './config.js'
import { LOOPBACK } from './kube.js'

// 플랫폼 서버(BE)의 기계용 API(`/api/pipeline/*`, docs/design/api.md "파이프라인 ↔ 플랫폼 서버")를 부르는 공통 클라이언트.
// 토큰은 Authorization 헤더로만 나가고 오류 · 로그에 싣지 않는다. 설정은 env: PLATFORM_API_URL(origin), PIPELINE_NOTIFY_TOKEN(GoCD secure 변수).

export interface PlatformConn {
  url: URL
  token: string
}

/** `https://api.stairnoworks.com`처럼 origin만 받는다. http는 같은 EC2의 로컬 호출(loopback)만 된다: 토큰이 평문으로 지나가지 않게. */
export function platformFromEnv(env: NodeJS.ProcessEnv): PlatformConn {
  const raw = env.PLATFORM_API_URL
  const url = raw ? URL.parse(raw) : null
  if (!url || url.pathname !== '/' || url.search || url.hash || url.username || !(url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.includes(url.hostname)))) {
    throw new Error('PLATFORM_API_URL must look like https://api.stairnoworks.com')
  }
  // BE는 32자 이상만 받는다. 값은 메시지에 싣지 않는다.
  const token = required(env, 'PIPELINE_NOTIFY_TOKEN', /^\S{32,}$/, 'a token of 32 or more characters without spaces')
  return { url, token }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** GoCD가 넣는 DEPLOY_ID. 요청 경로에 들어가는 값이라 UUID만 받는다(소문자로 맞춘다). */
export const deployIdFromEnv = (env: NodeJS.ProcessEnv): string => required(env, 'DEPLOY_ID', UUID, 'a UUID').toLowerCase()

export interface Issue {
  path: string
  code: string
}

/** 플랫폼 서버가 받아 주지 않았거나 닿지 못했다. `status`는 닿지 못했으면 null. */
export class PlatformError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly fields: Issue[] = [],
  ) {
    super(message)
  }
}

/** CLI 종료 코드: 플랫폼 서버가 4xx로 답했으면 1(같은 요청을 다시 해도 같다), 그 밖은 2(닿지 못함 · 503 · 크래시). */
export const exitCodeOf = (err: unknown): 1 | 2 => (err instanceof PlatformError && err.status !== null && err.status >= 400 && err.status < 500 ? 1 : 2)

export const CALL_TIMEOUT_MS = 10_000
// 503(DATABASE_UNAVAILABLE)과 연결 실패는 잠깐 뒤 다시 보내면 된다(알림은 다시 보내도 안전하다, api.md). 첫 시도 뒤 이만큼씩 기다리며 다시 한다.
export const RETRY_WAITS_MS = [1_000, 2_000, 4_000]

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// 오류 메시지에는 주소가 들어 있을 수 있어 오류 이름이나 코드(ECONNREFUSED · TimeoutError)만 남긴다.
function transportReason(err: unknown): string {
  const cause = err instanceof Error ? err.cause : undefined
  if (isRecord(cause) && typeof cause.code === 'string') return cause.code
  return err instanceof Error ? err.name : 'unknown error'
}

/** 서버의 오류 본문 `{ error: { code, message?, fields? } }`에서 코드와 고칠 칸을 읽는다. 읽을 수 없으면 비운다. */
function errorBody(text: string): { code: string | null; fields: Issue[] } {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return { code: null, fields: [] }
  }
  const error = isRecord(body) && isRecord(body.error) ? body.error : {}
  const fields = Array.isArray(error.fields) ? error.fields.filter(isRecord).map((f) => ({ path: String(f.path), code: String(f.code) })) : []
  return { code: typeof error.code === 'string' ? error.code : null, fields }
}

/**
 * 호출 하나. 2xx면 JSON 본문을 돌려준다. 503과 연결 실패는 `RETRY_WAITS_MS`만큼 다시 하고, 그 밖의 상태(400 · 401 · 404 …)는 바로 던진다.
 * 던지는 `PlatformError`는 상태와 서버가 알린 고칠 칸(`fields`)을 담는다.
 */
export async function callPlatform(
  conn: PlatformConn,
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  sleep: (ms: number) => Promise<void>,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<unknown> {
  const what = `${method} ${path}`
  for (let attempt = 0; ; attempt++) {
    let status = 0
    let text = ''
    let reason = ''
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${conn.token}`, Accept: 'application/json' }
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      // 다른 곳으로 넘어가는 답은 따라가지 않는다(헤더의 토큰이 따라가지 않게).
      const res = await fetch(new URL(path, conn.url), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
      status = res.status
      text = await res.text()
    } catch (err) {
      reason = transportReason(err)
    }
    if (status >= 200 && status < 300) {
      try {
        return JSON.parse(text)
      } catch {
        throw new PlatformError(`${what} answered ${status} with a body that is not JSON`, status)
      }
    }
    const transient = status === 0 || status === 503
    if (transient && attempt < RETRY_WAITS_MS.length) {
      await sleep(RETRY_WAITS_MS[attempt])
      continue
    }
    if (status === 0) throw new PlatformError(`${what} did not reach the platform server (${reason}), tried ${attempt + 1} times`, null)
    const { code, fields } = errorBody(text)
    const detail = [code, ...fields.map((f) => `${f.path} ${f.code}`)].filter((s) => s !== null)
    throw new PlatformError(`${what} answered ${status}${detail.length > 0 ? `: ${detail.join(', ')}` : ''}${transient ? `, tried ${attempt + 1} times` : ''}`, status, fields)
  }
}
