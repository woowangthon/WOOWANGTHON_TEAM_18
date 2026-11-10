import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { supabase } from './supabase.ts'

// BE는 오류를 { error: { code, message } }로 준다(docs/design/api.md). 화면은 message가 아니라 code로 구분한다.
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  // 400 INVALID_SPEC만 칸마다의 오류를 싣는다. 다른 오류에는 없다.
  readonly fields: { path: string; code: string }[]

  constructor(
    status: number,
    code: string,
    message: string,
    fields: { path: string; code: string }[] = [],
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

// 세션이 없거나 못 믿는 토큰이라는 뜻. 어느 API에서든 이 코드가 오면 로그인이 풀린 것으로 다룬다.
const SESSION_ERROR_CODES = ['AUTH_REQUIRED', 'INVALID_TOKEN']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// 프록시가 돌려준 502 같은 JSON이 아닌 본문도 오류로 읽을 수 있어야 한다.
async function readError(response: Response): Promise<ApiError> {
  let code = `HTTP_${response.status}`
  let message = response.statusText
  const fields: { path: string; code: string }[] = []
  try {
    const body: unknown = await response.json()
    if (isRecord(body) && isRecord(body.error)) {
      if (typeof body.error.code === 'string') code = body.error.code
      if (typeof body.error.message === 'string') message = body.error.message
      if (Array.isArray(body.error.fields)) {
        for (const field of body.error.fields as unknown[]) {
          if (isRecord(field) && typeof field.path === 'string' && typeof field.code === 'string') {
            fields.push({ path: field.path, code: field.code })
          }
        }
      }
    }
  } catch {
    // 본문이 JSON이 아니면 HTTP 상태로 만든 코드를 그대로 쓴다.
  }
  return new ApiError(response.status, code, message, fields)
}

// 요청 한 번. 네트워크 자체가 실패하면 ApiError로 바꿔 던진다.
async function send(path: string, body: unknown, token: string | undefined): Promise<Response> {
  const hasBody = body !== undefined
  const headers: Record<string, string> = {}
  // 세션이 없으면 헤더 없이 보내 BE의 401 AUTH_REQUIRED를 그대로 받는다.
  if (token) headers.Authorization = `Bearer ${token}`
  if (hasBody) headers['Content-Type'] = 'application/json'
  try {
    return await fetch(path, {
      method: hasBody ? 'POST' : 'GET',
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Network request failed')
  }
}

async function readBody<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T
  } catch {
    // 200인데 JSON이 아니면(예: SPA 폴백 HTML) 성공으로 넘기지 않는다.
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'Response body is not JSON')
  }
}

const isSessionError = (error: ApiError) =>
  error.status === 401 && SESSION_ERROR_CODES.includes(error.code)

// 다시 보낼 때 쓸 새 access token. 로그인이 풀렸으면(refresh token 거부 등) null이다.
// 함께 나간 다른 요청이나 다른 탭이 이미 갱신했다면 그 토큰을 쓴다. 같은 refresh token으로 또 갱신하다 세션을 잃지 않게 한다.
// 오프라인이나 서버 장애로 못 받은 것은 로그인이 풀린 것이 아니므로 던진다(F-1).
async function freshToken(sentToken: string): Promise<string | null> {
  const { data: stored } = await supabase.auth.getSession()
  const current = stored.session?.access_token
  if (current && current !== sentToken) return current

  const { data, error } = await supabase.auth.refreshSession()
  if (isAuthRetryableFetchError(error)) {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not refresh the session')
  }
  return data.session?.access_token ?? null
}

// body가 있으면 POST, 없으면 GET. 경로는 `/api/...` 상대 경로만 쓴다(운영 base URL은 아직 정해지지 않았다).
export async function apiFetch<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession()
  let response = await send(path, body, data.session?.access_token)
  if (response.ok) return readBody<T>(response)

  let error = await readError(response)
  if (isSessionError(error)) {
    // 로그아웃시키기 전에 한 번만 갱신해 다시 보낸다. 401은 BE 가드에서 나서 처리된 요청이 아니므로 다시 보내도 안전하다.
    const token = data.session ? await freshToken(data.session.access_token) : null
    if (token) {
      response = await send(path, body, token)
      if (response.ok) return readBody<T>(response)
      error = await readError(response)
    }
    // 이 기기만 로그아웃한다. 기본값(global)은 다른 기기의 세션도 폐기하고, 서버 응답을 기다린다.
    // 503이나 네트워크 오류는 여기까지 오지 않는다. 서버 장애를 "로그아웃"으로 바꾸지 않는다(F-1).
    if (isSessionError(error)) await supabase.auth.signOut({ scope: 'local' })
  }
  throw error
}
