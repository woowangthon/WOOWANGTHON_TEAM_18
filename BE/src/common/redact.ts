import { isRecord } from './is-record.js'

export const REDACTED = '[REDACTED]'

// 이름이 이런 칸의 값은 통째로 가린다(Pod의 env `{ name, value }`, 객체 키, `KEY=value` 줄 모두).
const SENSITIVE_WORDS = 'secret|token|passw(?:or)?d|pwd|api[_-]?key|credential|authorization|private[_-]?key|database_url|dsn'
const SENSITIVE_NAME = new RegExp(`(${SENSITIVE_WORDS})`, 'i')
const NAMED_VALUE = new RegExp(
  `((?:^|[\\s"'{,;])[A-Za-z0-9_.-]*(?:${SENSITIVE_WORDS})[A-Za-z0-9_.-]*["']?\\s*[=:]\\s*)("[^"]*"|'[^']*'|[^\\s,;}&]+)`,
  'gi',
)

// 값 자체가 비밀처럼 생긴 문자열. 순서와 무관하게 모두 적용한다.
const PATTERNS: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub 토큰
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g, // OpenAI류 키
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, // AWS 액세스 키 ID
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, // JWT
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, // Supabase 키
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
]

/** 문자열 안의 비밀처럼 보이는 부분을 가린다. */
export function redactString(text: string): string {
  let out = text
  // `Authorization: Bearer xxx` · `Bearer xxx`
  out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`)
  // `scheme://user:password@host`
  out = out.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)[^\s@/]+@/gi, `$1${REDACTED}@`)
  // `NAME=value` · `NAME: value` · `"name": "value"`에서 이름이 민감한 경우
  out = out.replace(NAMED_VALUE, `$1${REDACTED}`)
  for (const p of PATTERNS) out = out.replace(p, REDACTED)
  return out
}

/** 외부로 보내기 직전의 값에서 비밀처럼 보이는 문자열을 가린다(FR-102). 원본은 바꾸지 않고 사본을 돌려준다. */
export function redact(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map(redact)
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  // Pod env 항목 `{ name: "DB_PASSWORD", value: "…" }`: 이름이 민감하면 value를 가린다.
  const named = typeof value.name === 'string' && SENSITIVE_NAME.test(value.name)
  // k8s Secret 객체의 data · stringData는 값이 전부 비밀이다.
  const isSecret = value.kind === 'Secret'
  for (const [k, v] of Object.entries(value)) {
    // spec의 `secretKeys`는 비밀값이 아니라 key 이름 목록이다. 에이전트가 빠진 비밀값을 가려내는 데 필요하다. 안의 문자열은 그대로 필터를 거친다.
    if (k === 'secretKeys') out[k] = redact(v)
    else if (SENSITIVE_NAME.test(k) || (named && k === 'value') || (isSecret && (k === 'data' || k === 'stringData'))) {
      out[k] = v === null || v === undefined ? v : REDACTED
    } else {
      out[k] = redact(v)
    }
  }
  return out
}
