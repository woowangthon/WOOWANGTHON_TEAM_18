import { describe, expect, it } from 'vitest'
import { validateEnv } from './env.js'

// 필수값만 채운 입력. 각 테스트는 보려는 값만 덮어쓴다.
const base = {
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
}

describe('PORT', () => {
  it('defaults to 3000 when unset or empty', () => {
    expect(validateEnv(base).PORT).toBe(3000)
    expect(validateEnv({ ...base, PORT: '' }).PORT).toBe(3000)
  })

  it('parses an integer in range', () => {
    expect(validateEnv({ ...base, PORT: '1' }).PORT).toBe(1)
    expect(validateEnv({ ...base, PORT: '65535' }).PORT).toBe(65535)
  })

  it.each(['abc', '0', '65536', '3000.5', '-1', ' 3000', '1e3'])('rejects "%s"', (port) => {
    expect(() => validateEnv({ ...base, PORT: port })).toThrow(/PORT/)
  })
})

describe('CORS_ORIGINS', () => {
  it('is empty (no other origin allowed) when unset or empty', () => {
    expect(validateEnv(base).CORS_ORIGINS).toEqual([])
    expect(validateEnv({ ...base, CORS_ORIGINS: '' }).CORS_ORIGINS).toEqual([])
  })

  it('splits on commas, trims, and skips empty entries', () => {
    expect(
      validateEnv({ ...base, CORS_ORIGINS: ' https://a.example , http://localhost:5173,' }).CORS_ORIGINS,
    ).toEqual(['https://a.example', 'http://localhost:5173'])
  })

  it.each(['*', 'a.example', 'https://a.example/', 'https://a.example/app', 'null'])(
    'rejects "%s"',
    (origin) => {
      expect(() => validateEnv({ ...base, CORS_ORIGINS: origin })).toThrow(/CORS_ORIGINS/)
    },
  )
})

describe('SUPABASE_PUBLISHABLE_KEY', () => {
  it('is passed through', () => {
    expect(validateEnv(base).SUPABASE_PUBLISHABLE_KEY).toBe('sb_publishable_test')
  })

  it.each([undefined, ''])('is required (%s)', (key) => {
    expect(() => validateEnv({ ...base, SUPABASE_PUBLISHABLE_KEY: key })).toThrow(/SUPABASE_PUBLISHABLE_KEY is required/)
  })

  it.each([' abc', 'abc ', 'a b', 'abc\n'])('rejects whitespace in %j', (key) => {
    expect(() => validateEnv({ ...base, SUPABASE_PUBLISHABLE_KEY: key })).toThrow(/whitespace/)
  })
})

describe('SUPABASE_SECRET_KEY', () => {
  it('is passed through', () => {
    expect(validateEnv(base).SUPABASE_SECRET_KEY).toBe('sb_secret_test')
  })

  it.each([undefined, ''])('is required (%s)', (key) => {
    expect(() => validateEnv({ ...base, SUPABASE_SECRET_KEY: key })).toThrow(/SUPABASE_SECRET_KEY is required/)
  })

  it.each([' abc', 'abc ', 'a b', 'abc\n'])('rejects whitespace in %j', (key) => {
    expect(() => validateEnv({ ...base, SUPABASE_SECRET_KEY: key })).toThrow(/whitespace/)
  })

  it('does not put the key in the error message', () => {
    expect(() => validateEnv({ ...base, SUPABASE_SECRET_KEY: 'sb_secret_leak me' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('sb_secret_leak') as string }),
    )
  })
})

describe('SUPABASE_URL', () => {
  it('accepts a project origin', () => {
    expect(validateEnv(base).SUPABASE_URL).toBe('https://abc.supabase.co')
  })

  it.each(['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321'])('allows http for a local Supabase (%s)', (url) => {
    expect(validateEnv({ ...base, SUPABASE_URL: url }).SUPABASE_URL).toBe(url)
  })

  it.each(['http://abc.supabase.co', 'http://10.0.0.5:8000', 'ftp://abc.supabase.co'])('requires https for "%s"', (url) => {
    expect(() => validateEnv({ ...base, SUPABASE_URL: url })).toThrow(/must use https/)
  })

  it.each([undefined, ''])('is required (%s)', (url) => {
    expect(() => validateEnv({ ...base, SUPABASE_URL: url })).toThrow(/SUPABASE_URL is required/)
  })

  it.each(['abc.supabase.co', 'https://abc.supabase.co/', 'https://abc.supabase.co/auth/v1'])(
    'rejects "%s"',
    (url) => {
      expect(() => validateEnv({ ...base, SUPABASE_URL: url })).toThrow(/SUPABASE_URL .* is not an origin/)
    },
  )
})

describe('K8S_*', () => {
  const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'
  const full = { K8S_API_URL: 'https://100.64.0.1:6443', K8S_TOKEN: 'k8s-token', K8S_CA: pem }
  const none = { K8S_API_URL: undefined, K8S_TOKEN: undefined, K8S_CA: undefined }

  it('is undefined (cluster features off, server still boots) when all three are unset or empty', () => {
    expect(validateEnv(base)).toMatchObject(none)
    expect(validateEnv({ ...base, K8S_API_URL: '', K8S_TOKEN: '', K8S_CA: '' })).toMatchObject(none)
  })

  it('passes the three values through', () => {
    expect(validateEnv({ ...base, ...full })).toMatchObject(full)
  })

  it('turns \\n in a one-line CA into line breaks', () => {
    expect(validateEnv({ ...base, ...full, K8S_CA: String.raw`-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----` }).K8S_CA).toBe(pem)
  })

  it.each(['K8S_API_URL', 'K8S_TOKEN', 'K8S_CA'] as const)('stops when only %s is missing', (name) => {
    expect(() => validateEnv({ ...base, ...full, [name]: '' })).toThrow(new RegExp(`${name} must be set together`))
  })

  it('names every missing variable', () => {
    expect(() => validateEnv({ ...base, K8S_API_URL: full.K8S_API_URL })).toThrow(/K8S_TOKEN, K8S_CA must be set together/)
  })

  it('allows http only for localhost', () => {
    expect(validateEnv({ ...base, ...full, K8S_API_URL: 'http://127.0.0.1:6443' }).K8S_API_URL).toBe('http://127.0.0.1:6443')
    expect(() => validateEnv({ ...base, ...full, K8S_API_URL: 'http://100.64.0.1:6443' })).toThrow(/K8S_API_URL .* must use https/)
  })

  it.each(['100.64.0.1:6443', 'https://100.64.0.1:6443/', 'https://100.64.0.1:6443/api'])('rejects the address "%s"', (url) => {
    expect(() => validateEnv({ ...base, ...full, K8S_API_URL: url })).toThrow(/K8S_API_URL .* is not an origin/)
  })

  it.each([' abc', 'a b', 'abc\n'])('rejects whitespace in the token %j', (token) => {
    expect(() => validateEnv({ ...base, ...full, K8S_TOKEN: token })).toThrow(/K8S_TOKEN must not contain whitespace/)
  })

  it('rejects a CA that is not a PEM certificate', () => {
    expect(() => validateEnv({ ...base, ...full, K8S_CA: 'not a certificate' })).toThrow(/K8S_CA must be a PEM certificate/)
  })

  it('does not put the token or the CA in an error message', () => {
    const bad = { ...base, ...full, K8S_TOKEN: 'leak-token please', K8S_CA: 'leak-ca' }
    expect(() => validateEnv(bad)).toThrow(expect.objectContaining({ message: expect.not.stringContaining('leak') as string }))
    expect(() => validateEnv({ ...bad, K8S_TOKEN: 'leak-token' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('leak') as string }),
    )
  })
})
