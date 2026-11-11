import { createHmac } from 'node:crypto'
import { isRecord } from '../common/is-record.js'
import { type Issue, isEnvName, MAX_ISSUES, SERVICE_NAME, type Spec } from './deploy-input.js'
import type { SecretRow } from './deploys.store.js'

// 비밀값 입력의 검증과 상태 · 해시 계산. 규칙 코드이고 AI가 아니다. 계약은 docs/design/api.md "비밀값".
// 오류 칸에는 서비스 이름과 key 이름만 싣는다. 값은 어디에도 싣지 않는다. 경로는 `secrets.<서비스>.<KEY>`이고 배포 시작의 NOT_READY와 같은 모양이다(요청 본문의 칸 이름은 `services`).

/** 값 하나의 최대 길이(글자 수). */
export const MAX_SECRET_LENGTH = 8192

/** 서비스 이름 → { key: 값 }. 서비스의 `secretKeys`와 key가 정확히 같다. */
export type SecretValues = Map<string, Record<string, string>>

/**
 * `input`은 요청 본문의 `services`. 서비스마다 그 서비스의 `secretKeys`와 같은 key 집합이어야 하고(빠진 key · 모르는 key 거절),
 * 값은 비어 있거나 공백뿐이면 안 되며(다듬지는 않는다) 길이 제한이 있다.
 */
export function validateSecrets(input: unknown, spec: Spec): { ok: true; values: SecretValues } | { ok: false; issues: Issue[] } {
  const issues: Issue[] = []
  const paths = new Set<string>()
  // 칸마다 코드는 하나만 남기고, 터무니없는 입력이 응답을 키우지 못하게 개수를 막는다.
  const add = (path: string, code: Issue['code']) => {
    if (issues.length >= MAX_ISSUES || paths.has(path)) return
    paths.add(path)
    issues.push({ path, code })
  }

  if (!isRecord(input)) {
    add('secrets', input === undefined ? 'REQUIRED' : 'INVALID_TYPE')
    return { ok: false, issues }
  }
  if (Object.keys(input).length === 0) add('secrets', 'REQUIRED')

  const values: SecretValues = new Map()
  for (const [name, raw] of Object.entries(input)) {
    const service = spec.services.find((s) => s.name === name)
    // 이름이 서비스 이름 모양이 아니면 응답에 싣지 않고 한 칸 위 경로로 알린다.
    if (!service) {
      add(SERVICE_NAME.test(name) ? `secrets.${name}` : 'secrets', 'UNKNOWN_SERVICE')
      continue
    }
    const path = `secrets.${name}`
    if (!isRecord(raw)) {
      add(path, 'INVALID_TYPE')
      continue
    }
    const expected = service.runtime.secretKeys
    const given: Record<string, string> = {}
    for (const key of expected) {
      const value = Object.hasOwn(raw, key) ? raw[key] : undefined
      if (value === undefined) add(`${path}.${key}`, 'REQUIRED')
      else if (typeof value !== 'string') add(`${path}.${key}`, 'INVALID_TYPE')
      else if (value.trim() === '') add(`${path}.${key}`, 'REQUIRED')
      else if (value.length > MAX_SECRET_LENGTH) add(`${path}.${key}`, 'OUT_OF_RANGE')
      else given[key] = value
    }
    for (const key of Object.keys(raw)) {
      if (!expected.includes(key)) add(isEnvName(key) ? `${path}.${key}` : path, 'UNKNOWN_KEY')
    }
    values.set(name, given)
  }
  return issues.length === 0 ? { ok: true, values } : { ok: false, issues }
}

/**
 * 비밀값의 해시는 서버 전용 키(`SECRET_HASH_KEY`)로 만든 HMAC-SHA256이다. 키 없는 sha256이면 DB 행이나 파드 주석의 `secretHash`를 읽은 쪽이
 * 짧은 값을 사전 대입으로 맞춰 볼 수 있다. 서비스 해시와 합친 해시는 입력 모양이 같아 서로 겹칠 수 있어 앞에 용도를 붙여 가른다.
 * 앞의 `sha256:`은 DB의 형식 검사(`^sha256:[0-9a-f]{64}$`)가 그대로 맞게 두는 이름표다.
 */
const keyedDigest = (key: string, purpose: 'service' | 'combined', json: string): string =>
  `sha256:${createHmac('sha256', key).update(`${purpose}\n${json}`, 'utf8').digest('hex')}`

/** 서비스의 key · 값 쌍의 해시. key 순으로 정렬해 같은 값이면 항상 같다. JSON 배열이라 경계가 모호하지 않다. */
export function serviceDigest(values: Record<string, string>, hashKey: string): string {
  return keyedDigest(hashKey, 'service', JSON.stringify(Object.keys(values).sort().map((key) => [key, values[key]])))
}

/** 서비스별 해시를 이름 순으로 합친 W4용 `secretHash`. */
export function combineDigests(parts: { name: string; digest: string }[], hashKey: string): string {
  return keyedDigest(hashKey, 'combined', JSON.stringify(parts.map((p) => [p.name, p.digest]).sort((a, b) => (a[0] < b[0] ? -1 : 1))))
}

export interface SecretStatus {
  ready: boolean
  secretHash: string | null
  services: { name: string; status: 'in' | 'missing'; keys: { key: string; status: 'in' | 'missing' }[] }[]
}

/**
 * 저장한 상태(`rows`)로 본 비밀값 상태. 서비스는 지금 `secretKeys`와 같은 key 집합으로 쓰기가 끝났을 때만 `in`이다(`writing`이거나
 * key가 다르면 `missing`). `secretKeys`가 없는 서비스는 나오지 않는다. 준비됨은 나온 서비스가 모두 `in`일 때다.
 */
export function secretStatus(spec: Spec, rows: SecretRow[], hashKey: string): SecretStatus {
  const services: SecretStatus['services'] = []
  const digests: { name: string; digest: string }[] = []
  for (const { name, runtime } of spec.services) {
    const wanted = runtime.secretKeys
    if (wanted.length === 0) continue
    const row = rows.find((r) => r.service === name)
    const done = row !== undefined && row.status === 'in' && row.digest !== null && sameKeys(row.keys, wanted)
    const status = done ? 'in' : 'missing'
    if (done) digests.push({ name, digest: row.digest! })
    services.push({ name, status, keys: wanted.map((key) => ({ key, status })) })
  }
  const ready = services.every((s) => s.status === 'in')
  return { ready, secretHash: ready && digests.length > 0 ? combineDigests(digests, hashKey) : null, services }
}

const sameKeys = (a: string[], b: string[]) => a.length === b.length && a.every((k) => b.includes(k))
