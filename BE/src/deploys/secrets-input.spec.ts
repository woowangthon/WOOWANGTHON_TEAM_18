import { describe, expect, it } from 'vitest'
import type { Spec } from './deploy-input.js'
import type { SecretRow } from './deploys.store.js'
import { combineDigests, MAX_SECRET_LENGTH, secretStatus, serviceDigest, validateSecrets } from './secrets-input.js'

// 이 검증이 읽는 칸(서비스 이름 · secretKeys)만 채운 spec.
const svc = (name: string, secretKeys: string[]) => ({ name, runtime: { secretKeys } })
const spec = {
  project: { slug: 'my-app', repo: 'student/my-app' },
  services: [svc('fe', []), svc('be', ['DATABASE_URL', 'JWT_SECRET']), svc('ai', ['OPENAI_API_KEY'])],
} as unknown as Spec
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

  it('a value of exactly the maximum length', () => {
    const be = { DATABASE_URL: 'x'.repeat(MAX_SECRET_LENGTH), JWT_SECRET: 'j' }
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
    ['a value that is too long', { ...full, be: { ...full.be, JWT_SECRET: 'x'.repeat(MAX_SECRET_LENGTH + 1) } }, [{ path: 'secrets.be.JWT_SECRET', code: 'OUT_OF_RANGE' }]],
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
  it('is sha256 of the key-sorted [key, value] pairs as JSON (value computed independently)', () => {
    expect(serviceDigest({ A: '1', B: '2' })).toBe('sha256:b520ef3fdba6b3bf44b4f861557837d41373b19d5667a5ad2e9b0b46f1f3baf1')
    // 값은 UTF-8이고 JSON 이스케이프를 거친다.
    expect(serviceDigest({ KEY: '비밀 값\n' })).toBe('sha256:b8930f0c416b619e3933364c143682d9676c038874f16c0831bf59288c3b3acb')
  })

  it('does not depend on the order the keys were given in', () => {
    expect(serviceDigest({ B: '2', A: '1' })).toBe(serviceDigest({ A: '1', B: '2' }))
  })

  it('changes with a value, a key, or a moved boundary between key and value', () => {
    const base = serviceDigest({ A: '1' })
    expect(serviceDigest({ A: '2' })).not.toBe(base)
    expect(serviceDigest({ B: '1' })).not.toBe(base)
    expect(serviceDigest({ a: 'bc' })).toBe('sha256:d61af79ec530ca91c518c00e92bd704d0ab0f38ee776b45ce21bfb8f6ae3c1a2')
    expect(serviceDigest({ ab: 'c' })).toBe('sha256:8b95198c4ed14fd37f0d961a25e679d248d23c3e0c896f28512a47eca6c19c2b')
  })

  it('is "sha256:" and 64 hex characters', () => {
    expect(serviceDigest({})).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})

describe('combineDigests', () => {
  const a = serviceDigest({ A: '1', B: '2' })
  const c = serviceDigest({ C: '3' })

  it('is sha256 of the name-sorted [name, digest] pairs as JSON (value computed independently)', () => {
    expect(combineDigests([{ name: 'be', digest: c }, { name: 'ai', digest: a }])).toBe(
      'sha256:88a35097103ed9c6033e9363f6f973053de561f7f15ee05ffdb48be08dc79b59',
    )
  })

  it('does not depend on the order of the services', () => {
    expect(combineDigests([{ name: 'ai', digest: a }, { name: 'be', digest: c }])).toBe(
      combineDigests([{ name: 'be', digest: c }, { name: 'ai', digest: a }]),
    )
  })

  it('changes when a service digest or a service name changes', () => {
    expect(combineDigests([{ name: 'ai', digest: a }])).not.toBe(combineDigests([{ name: 'ai', digest: c }]))
    expect(combineDigests([{ name: 'ai', digest: a }])).not.toBe(combineDigests([{ name: 'be', digest: a }]))
  })
})

describe('secretStatus', () => {
  const be: SecretRow = { service: 'be', keys: ['DATABASE_URL', 'JWT_SECRET'], status: 'in', digest: serviceDigest(full.be) }
  const ai: SecretRow = { service: 'ai', keys: ['OPENAI_API_KEY'], status: 'in', digest: serviceDigest(full.ai) }

  it('is ready with the hash when every service that has secret keys is in; services without secret keys do not appear', () => {
    const s = secretStatus(spec, [be, ai])
    expect(s).toEqual({
      ready: true,
      secretHash: combineDigests([{ name: 'be', digest: be.digest! }, { name: 'ai', digest: ai.digest! }]),
      services: [
        { name: 'be', status: 'in', keys: [{ key: 'DATABASE_URL', status: 'in' }, { key: 'JWT_SECRET', status: 'in' }] },
        { name: 'ai', status: 'in', keys: [{ key: 'OPENAI_API_KEY', status: 'in' }] },
      ],
    })
  })

  it('is not ready, with no hash, when a service is missing; the others keep their state', () => {
    const s = secretStatus(spec, [be])
    expect(s.ready).toBe(false)
    expect(s.secretHash).toBeNull()
    expect(s.services.map((x) => [x.name, x.status])).toEqual([['be', 'in'], ['ai', 'missing']])
    expect(s.services[1].keys).toEqual([{ key: 'OPENAI_API_KEY', status: 'missing' }])
  })

  it('has no rows at all: every service is missing', () => {
    expect(secretStatus(spec, []).services.map((x) => x.status)).toEqual(['missing', 'missing'])
  })

  it.each<[string, SecretRow]>([
    ['still writing', { ...be, status: 'writing', digest: null }],
    ['writing even with a digest left from before', { ...be, status: 'writing' }],
    ['written with other keys', { ...be, keys: ['DATABASE_URL', 'OTHER'] }],
    ['written with fewer keys', { ...be, keys: ['DATABASE_URL'] }],
    ['written with more keys', { ...be, keys: ['DATABASE_URL', 'JWT_SECRET', 'EXTRA'] }],
    ['in but with no digest', { ...be, digest: null }],
  ])('a row that is %s is missing', (_, row) => {
    const s = secretStatus(spec, [row, ai])
    expect(s.services[0]).toMatchObject({ name: 'be', status: 'missing' })
    expect(s.ready).toBe(false)
  })

  it('accepts the same keys in another order', () => {
    expect(secretStatus(spec, [{ ...be, keys: ['JWT_SECRET', 'DATABASE_URL'] }, ai]).ready).toBe(true)
  })

  it('is ready with no hash and no services when nothing needs a secret', () => {
    const none = { project: spec.project, services: [svc('fe', [])] } as unknown as Spec
    expect(secretStatus(none, [])).toEqual({ ready: true, secretHash: null, services: [] })
  })

  it('ignores a row of a service that no longer exists', () => {
    expect(secretStatus(spec, [be, ai, { ...ai, service: 'gone' }]).services).toHaveLength(2)
  })
})
