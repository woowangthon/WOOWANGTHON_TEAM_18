import { supabase } from './supabase.ts'

// BE는 오류를 { error: { code, message } }로 준다(docs/design/api.md). 화면은 message가 아니라 code로 구분한다.
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
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
  try {
    const body: unknown = await response.json()
    if (isRecord(body) && isRecord(body.error)) {
      if (typeof body.error.code === 'string') code = body.error.code
      if (typeof body.error.message === 'string') message = body.error.message
    }
  } catch {
    // 본문이 JSON이 아니면 HTTP 상태로 만든 코드를 그대로 쓴다.
  }
  return new ApiError(response.status, code, message)
}

// body가 있으면 POST, 없으면 GET. 경로는 `/api/...` 상대 경로만 쓴다(운영 base URL은 아직 정해지지 않았다).
export async function apiFetch<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const headers: Record<string, string> = {}
  // 세션이 없으면 헤더 없이 보내 BE의 401 AUTH_REQUIRED를 그대로 받는다.
  if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Network request failed')
  }

  if (!response.ok) {
    const error = await readError(response)
    // 503이나 네트워크 오류는 로그아웃시키지 않는다. 서버 장애를 "로그아웃"으로 바꾸지 않는다(F-1).
    if (response.status === 401 && SESSION_ERROR_CODES.includes(error.code)) {
      await supabase.auth.signOut()
    }
    throw error
  }

  try {
    return (await response.json()) as T
  } catch {
    // 200인데 JSON이 아니면(예: SPA 폴백 HTML) 성공으로 넘기지 않는다.
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'Response body is not JSON')
  }
}
