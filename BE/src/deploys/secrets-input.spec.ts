import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Spec } from './deploy-input.js'
import type { SecretRow } from './deploys.store.js'
import { combineDigests, secretStatus, serviceDigest, validateSecrets } from './secrets-input.js'

// 이 검증이 읽는 칸(서비스 이름 · secretKeys)만 채운 spec.
const svc = (name: string, secretKeys: string[]) => ({ name, runtime: { secretKeys } })
const spec = {
  project: { slug: 'my-app', repo: 'student/my-app' },
  services: [svc('fe', []), svc('be', ['DATABASE_URL', 'JWT_SECRET']), svc('ai', ['OPENAI_API_KEY'])],
} as unknown as Spec
// 해시 키는 시험용이다(서버는 32자 이상 SECRET_HASH_KEY).
const KEY = 'secret_hash_key_test_0123456789abcdef'
const full = { be: { DATABASE_URL: 'postgres://x', JWT_SECRET: 'j' }, ai: { OPENAI_API_KEY: 'sk-1' } }

const issuesOf = (input: unknown) => {
  const r = validateSecrets(input, spec)
  if (r.ok) throw new Error('expected issues')
  return r.issues
}

describe('validateSecrets accepts', () => {
  it('every secret key of every service and returns the values per service', () => {
    const r = validateSecrets(full, spec)
    expect(r).toEqual({ ok: true, values: new Map(Object.entries(full)) })
  })

  it('only some of the services, because services are sent separately', () => {
    const r = validateSecrets({ ai: full.ai }, spec)
    expect(r).toEqual({ ok: true, values: new Map([['ai', full.ai]]) })
  })

  it('values as they are: no trimming, spaces and line breaks kept', () => {
    const be = { DATABASE_URL: '  pw with spaces \n', JWT_SECRET: '비밀 값\n' }
    const r = validateSecrets({ be }, spec)
    expect(r).toEqual({ ok: true, values: new Map([['be', be]]) })
  })

  // 계약의 값: 값 하나는 8,192자까지(상수를 가져오지 않고 적어 두어 계약이 바뀌면 시험이 알린다).
  it('a value of exactly the maximum length', () => {
    const be = { DATABASE_URL: 'x'.repeat(8192), JWT_SECRET: 'j' }
    expect(validateSecrets({ be }, spec).ok).toBe(true)
  })

  it('an empty object for a service that has no secret keys (nothing to write)', () => {
    expect(validateSecrets({ fe: {} }, spec)).toEqual({ ok: true, values: new Map([['fe', {}]]) })
  })
})

describe('validateSecrets rejects, by path and code', () => {
  it.each([
    ['nothing sent', undefined, [{ path: 'secrets', code: 'REQUIRED' }]],
    ['no services', {}, [{ path: 'secrets', code: 'REQUIRED' }]],
    ['a list', [], [{ path: 'secrets', code: 'INVALID_TYPE' }]],
    ['a string', 'x', [{ path: 'secrets', code: 'INVALID_TYPE' }]],
    ['null', null, [{ path: 'secrets', code: 'INVALID_TYPE' }]],
    ['a service that is not an object', { ...full, be: 'x' }, [{ path: 'secrets.be', code: 'INVALID_TYPE' }]],
    ['a service that is a list', { ...full, be: [] }, [{ path: 'secrets.be', code: 'INVALID_TYPE' }]],
    ['an unknown service', { ...full, nope: { A: '1' } }, [{ path: 'secrets.nope', code: 'UNKNOWN_SERVICE' }]],
    ['a name that is not a service name, which is not echoed', { ...full, 'Bad Name!': {} }, [{ path: 'secrets', code: 'UNKNOWN_SERVICE' }]],
    ['a missing key', { ...full, be: { DATABASE_URL: 'x' } }, [{ path: 'secrets.be.JWT_SECRET', code: 'REQUIRED' }]],
    ['an unknown key', { ...full, be: { ...full.be, EXTRA: 'x' } }, [{ path: 'secrets.be.EXTRA', code: 'UNKNOWN_KEY' }]],
    ['a key that is not an env name, which is not echoed', { ...full, be: { ...full.be, 'a b': 'x' } }, [{ path: 'secrets.be', code: 'UNKNOWN_KEY' }]],
    ['a key for a service without secret keys', { fe: { A: '1' } }, [{ path: 'secrets.fe.A', code: 'UNKNOWN_KEY' }]],
    ['a value that is too long', { ...full, be: { ...full.be, JWT_SECRET: 'x'.repeat(8193) } }, [{ path: 'secrets.be.JWT_SECRET', code: 'OUT_OF_RANGE' }]],
  ])('%s', (_, input, expected) => {
    expect(issuesOf(input)).toEqual(expected)
  })

  it.each([['an empty string', ''], ['spaces only', '   '], ['tabs and line breaks only', '\t\n \r\n'], ['a no-break space only', ' ']])(
    'blank value: %s counts as not given',
    (_, value) => {
      expect(issuesOf({ ...full, be: { ...full.be, JWT_SECRET: value } })).toEqual([{ path: 'secrets.be.JWT_SECRET', code: 'REQUIRED' }])
    },
  )

  it.each([['a number', 123], ['null', null], ['true', true], ['an object', { a: 1 }], ['a list', ['x']]])('a value that is %s', (_, value) => {
    expect(issuesOf({ ...full, be: { ...full.be, JWT_SECRET: value } })).toEqual([{ path: 'secrets.be.JWT_SECRET', code: 'INVALID_TYPE' }])
  })

  it('reports a missing key and an unknown key together, in the order of the secret keys then the extras', () => {
    expect(issuesOf({ be: { DATABASE_URL: 'x', EXTRA: 'y' } })).toEqual([
      { path: 'secrets.be.JWT_SECRET', code: 'REQUIRED' },
      { path: 'secrets.be.EXTRA', code: 'UNKNOWN_KEY' },
    ])
  })

  it('does not treat a key of Object.prototype as given', () => {
    const s = { project: spec.project, services: [svc('be', ['constructor'])] } as unknown as Spec
    const r = validateSecrets({ be: {} }, s)
    expect(r).toEqual({ ok: false, issues: [{ path: 'secrets.be.constructor', code: 'REQUIRED' }] })
  })

  it('treats an own __proto__ key as a key that is not an env name', () => {
    const be = JSON.parse('{"DATABASE_URL":"x","JWT_SECRET":"j","__proto__":"x"}') as unknown
    expect(issuesOf({ be })).toEqual([{ path: 'secrets.be', code: 'UNKNOWN_KEY' }])
  })

  it('keeps one code per path and stops at 20 paths', () => {
    const be = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`EXTRA_${i}`, 'x']))
    expect(issuesOf({ be })).toHaveLength(20)
    expect(new Set(issuesOf({ be }).map((i) => i.path)).size).toBe(20)
  })

  it('never puts a value in an issue', () => {
    const issues = issuesOf({
      be: { DATABASE_URL: 'secret-value-1', JWT_SECRET: '', EXTRA: 'secret-value-2', 'bad key': 'secret-value-3' },
      nope: { A: 'secret-value-4' },
    })
    expect(issues.length).toBeGreaterThan(0)
    expect(JSON.stringify(issues)).not.toContain('secret-value')
  })
})

describe('serviceDigest', () => {
  it('is HMAC-SHA256 under the server key of the key-sorted [key, value] pairs as JSON (values computed independently)', () => {
    expect(serviceDigest({ A: '1', B: '2' }, KEY)).toBe('sha256:f4ad492456c9ccbefde183c65f66229ce2375dacabe9f83b8a06061f396cd477')
    // 값은 UTF-8이고 JSON 이스케이프를 거친다.
    expect(serviceDigest({ KEY: '비밀 값\n' }, KEY)).toBe('sha256:5d3ad21bbee7ac80796e7dc19c55195cea956b3655197e15cc16a958797be68b')
  })

  it('is not the plain sha256 of the values, and the same values under another key give another digest', () => {
    const pairs = JSON.stringify([['A', '1'], ['B', '2']])
    const digest = serviceDigest({ A: '1', B: '2' }, KEY)
    expect(digest).not.toBe(`sha256:${createHash('sha256').update(pairs).digest('hex')}`)
    expect(digest).not.toBe(`sha256:${createHash('sha256').update(`service\n${pairs}`).digest('hex')}`)
    expect(serviceDigest({ A: '1', B: '2' }, 'another_secret_hash_key_0123456789ab')).not.toBe(digest)
  })

  it('does not depend on the order the keys were given in', () => {
    expect(serviceDigest({ B: '2', A: '1' }, KEY)).toBe(serviceDigest({ A: '1', B: '2' }, KEY))
  })

  it('changes with a value, a key, or a moved boundary between key and value', () => {
    const base = serviceDigest({ A: '1' }, KEY)
    expect(serviceDigest({ A: '2' }, KEY)).not.toBe(base)
    expect(serviceDigest({ B: '1' }, KEY)).not.toBe(base)
    expect(serviceDigest({ a: 'bc' }, KEY)).toBe('sha256:e0fb55b7ccfb68f25aa4b4190d4cacda2e6e84be9dd4ae2a4997471e588b363e')
    expect(serviceDigest({ ab: 'c' }, KEY)).toBe('sha256:31f6e39d95afc81e487a46048a7e7d3e58296898de85189a55f9a5d8be78d9e4')
  })

  it('is "sha256:" and 64 hex characters (the database check)', () => {
    expect(serviceDigest({}, KEY)).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})

describe('combineDigests', () => {
  const a = serviceDigest({ A: '1', B: '2' }, KEY)
  const c = serviceDigest({ C: '3' }, KEY)
  const parts = [{ name: 'be', digest: c }, { name: 'ai', digest: a }]

  it('is HMAC-SHA256 under the server key of the name-sorted [name, digest] pairs as JSON (value computed independently)', () => {
    expect(combineDigests(parts, KEY)).toBe('sha256:6d0e9eb8de48bc9226f4e48f7bed02d4920032dcb186919862c5dfeb4802d45c')
  })

  it('changes with the server key', () => {
    expect(combineDigests(parts, 'another_secret_hash_key_0123456789ab')).not.toBe(combineDigests(parts, KEY))
  })

  it('does not collide with a service digest of the same-shaped input (they are told apart by purpose)', () => {
    expect(combineDigests([{ name: 'be', digest: 'sha256:x' }], KEY)).not.toBe(serviceDigest({ be: 'sha256:x' }, KEY))
  })

  it('does not depend on the order of the services', () => {
    expect(combineDigests([{ name: 'ai', digest: a }, { name: 'be', digest: c }], KEY)).toBe(combineDigests(parts, KEY))
  })

  it('changes when a service digest or a service name changes', () => {
    expect(combineDigests([{ name: 'ai', digest: a }], KEY)).not.toBe(combineDigests([{ name: 'ai', digest: c }], KEY))
    expect(combineDigests([{ name: 'ai', digest: a }], KEY)).not.toBe(combineDigests([{ name: 'be', digest: a }], KEY))
  })
})

describe('secretStatus', () => {
  const be: SecretRow = { service: 'be', keys: ['DATABASE_URL', 'JWT_SECRET'], status: 'in', digest: serviceDigest(full.be, KEY) }
  const ai: SecretRow = { service: 'ai', keys: ['OPENAI_API_KEY'], status: 'in', digest: serviceDigest(full.ai, KEY) }

  it('is ready with the hash when every service that has secret keys is in; services without secret keys do not appear', () => {
    const s = secretStatus(spec, [be, ai], KEY)
    expect(s).toEqual({
      ready: true,
      secretHash: combineDigests([{ name: 'be', digest: be.digest! }, { name: 'ai', digest: ai.digest! }], KEY),
      services: [
        { name: 'be', status: 'in', keys: [{ key: 'DATABASE_URL', status: 'in' }, { key: 'JWT_SECRET', status: 'in' }] },
        { name: 'ai', status: 'in', keys: [{ key: 'OPENAI_API_KEY', status: 'in' }] },
      ],
    })
  })

  it('is not ready, with no hash, when a service is missing; the others keep their state', () => {
    const s = secretStatus(spec, [be], KEY)
    expect(s.ready).toBe(false)
    expect(s.secretHash).toBeNull()
    expect(s.services.map((x) => [x.name, x.status])).toEqual([['be', 'in'], ['ai', 'missing']])
    expect(s.services[1].keys).toEqual([{ key: 'OPENAI_API_KEY', status: 'missing' }])
  })

  it('has no rows at all: every service is missing', () => {
    expect(secretStatus(spec, [], KEY).services.map((x) => x.status)).toEqual(['missing', 'missing'])
  })

  it.each<[string, SecretRow]>([
    ['still writing', { ...be, status: 'writing', digest: null }],
    ['writing even with a digest left from before', { ...be, status: 'writing' }],
    ['written with other keys', { ...be, keys: ['DATABASE_URL', 'OTHER'] }],
    ['written with fewer keys', { ...be, keys: ['DATABASE_URL'] }],
    ['written with more keys', { ...be, keys: ['DATABASE_URL', 'JWT_SECRET', 'EXTRA'] }],
    ['in but with no digest', { ...be, digest: null }],
  ])('a row that is %s is missing', (_, row) => {
    const s = secretStatus(spec, [row, ai], KEY)
    expect(s.services[0]).toMatchObject({ name: 'be', status: 'missing' })
    expect(s.ready).toBe(false)
  })

  it('accepts the same keys in another order', () => {
    expect(secretStatus(spec, [{ ...be, keys: ['JWT_SECRET', 'DATABASE_URL'] }, ai], KEY).ready).toBe(true)
  })

  it('is ready with no hash and no services when nothing needs a secret', () => {
    const none = { project: spec.project, services: [svc('fe', [])] } as unknown as Spec
    expect(secretStatus(none, [], KEY)).toEqual({ ready: true, secretHash: null, services: [] })
  })

  it('ignores a row of a service that no longer exists', () => {
    expect(secretStatus(spec, [be, ai, { ...ai, service: 'gone' }], KEY).services).toHaveLength(2)
  })
})
