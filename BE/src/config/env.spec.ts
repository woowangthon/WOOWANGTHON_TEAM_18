import { describe, expect, it } from 'vitest'
import { validateEnv } from './env.js'

// 필수값만 채운 입력. 각 테스트는 보려는 값만 덮어쓴다.
const base = {
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  SECRET_HASH_KEY: 'secret_hash_key_test_0123456789abcdef',
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

describe('pipeline and AI server settings', () => {
  const names = ['GOCD_URL', 'GOCD_TOKEN', 'GOCD_PIPELINE', 'GOCD_TRIAL_PIPELINE', 'PIPELINE_NOTIFY_TOKEN', 'AI_SERVER_URL', 'AGENT_API_TOKEN', 'BOT_GITHUB_TOKEN'] as const

  it('are optional: unset or empty means the feature is off', () => {
    for (const raw of [base, { ...base, ...Object.fromEntries(names.map((n) => [n, ''])) }]) {
      const env = validateEnv(raw)
      for (const n of names) expect(env[n]).toBeUndefined()
    }
  })

  it('are passed through when valid', () => {
    const env = validateEnv({
      ...base,
      GOCD_URL: 'https://gocd.example.com',
      GOCD_TOKEN: 'tok',
      GOCD_PIPELINE: 'student-deploy',
      GOCD_TRIAL_PIPELINE: 'student-trial',
      PIPELINE_NOTIFY_TOKEN: 'n'.repeat(32),
      AI_SERVER_URL: 'http://localhost:8000',
      AGENT_API_TOKEN: 'a',
    })
    expect(env).toMatchObject({ GOCD_URL: 'https://gocd.example.com', GOCD_PIPELINE: 'student-deploy', GOCD_TRIAL_PIPELINE: 'student-trial', AI_SERVER_URL: 'http://localhost:8000' })
  })

  it.each([
    ['GOCD_URL', 'gocd.example.com'],
    ['GOCD_URL', 'https://gocd.example.com/'],
    ['AI_SERVER_URL', 'https://ai.example.com/agent'],
    ['GOCD_TOKEN', 'a b'],
    ['BOT_GITHUB_TOKEN', 'a b'],
    ['PIPELINE_NOTIFY_TOKEN', 'a\nb'],
    ['PIPELINE_NOTIFY_TOKEN', 'x'.repeat(31)],
    ['AGENT_API_TOKEN', ' x'],
    ['GOCD_PIPELINE', 'a/b'],
    ['GOCD_TRIAL_PIPELINE', 'a b'],
  ])('rejects %s = "%s" at boot', (name, value) => {
    expect(() => validateEnv({ ...base, [name]: value })).toThrow(new RegExp(name))
  })

  it('does not put a bad secret in the error message', () => {
    expect(() => validateEnv({ ...base, GOCD_TOKEN: 'very secret value' })).toThrow(/^(?!.*very secret)/s)
  })
})

describe('GATEWAY_PORT', () => {
  it('is undefined (gateway closed) when unset or empty', () => {
    expect(validateEnv(base).GATEWAY_PORT).toBeUndefined()
    expect(validateEnv({ ...base, GATEWAY_PORT: '' }).GATEWAY_PORT).toBeUndefined()
  })

  it('parses an integer in range', () => {
    expect(validateEnv({ ...base, GATEWAY_PORT: '3100' }).GATEWAY_PORT).toBe(3100)
  })

  it.each(['0', '65536', '31.5', 'abc', '-1'])('rejects "%s" at boot', (value) => {
    expect(() => validateEnv({ ...base, GATEWAY_PORT: value })).toThrow(/GATEWAY_PORT/)
  })

  it('must differ from the public PORT, including its default', () => {
    expect(() => validateEnv({ ...base, PORT: '4000', GATEWAY_PORT: '4000' })).toThrow('GATEWAY_PORT must differ from PORT')
    expect(() => validateEnv({ ...base, GATEWAY_PORT: '3000' })).toThrow('GATEWAY_PORT must differ from PORT')
  })
})

describe('TRIVY_CACHE_DIR', () => {
  it('is optional: empty means the security scan is off', () => {
    expect(validateEnv(base).TRIVY_CACHE_DIR).toBeUndefined()
    expect(validateEnv({ ...base, TRIVY_CACHE_DIR: '' }).TRIVY_CACHE_DIR).toBeUndefined()
    expect(validateEnv({ ...base, TRIVY_CACHE_DIR: '/var/cache/trivy' }).TRIVY_CACHE_DIR).toBe('/var/cache/trivy')
  })

  it.each(['var/cache/trivy', './cache', '/a\nb'])('stops the boot on a path that is not absolute: %j', (value) => {
    expect(() => validateEnv({ ...base, TRIVY_CACHE_DIR: value })).toThrow(/TRIVY_CACHE_DIR/)
  })
})

describe('K8S_*', () => {
  const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'
  const b64 = (text: string) => Buffer.from(text).toString('base64')
  const full = { K8S_API_URL: 'https://100.64.0.1:6443', K8S_TOKEN: 'k8s-token', K8S_CA_CERT: b64(pem) }
  const none = { K8S_API_URL: undefined, K8S_TOKEN: undefined, K8S_CA_CERT: undefined }

  it('is undefined (cluster features off, server still boots) when all three are unset or empty', () => {
    expect(validateEnv(base)).toMatchObject(none)
    expect(validateEnv({ ...base, K8S_API_URL: '', K8S_TOKEN: '', K8S_CA_CERT: '' })).toMatchObject(none)
  })

  it('passes the address and token through and decodes the CA from base64 to the PEM', () => {
    expect(validateEnv({ ...base, ...full })).toMatchObject({ K8S_API_URL: full.K8S_API_URL, K8S_TOKEN: 'k8s-token', K8S_CA_CERT: pem })
  })

  it.each(['K8S_API_URL', 'K8S_TOKEN', 'K8S_CA_CERT'] as const)('stops when only %s is missing', (name) => {
    expect(() => validateEnv({ ...base, ...full, [name]: '' })).toThrow(new RegExp(`${name} must be set together`))
  })

  it('names every missing variable', () => {
    expect(() => validateEnv({ ...base, K8S_API_URL: full.K8S_API_URL })).toThrow(/K8S_TOKEN, K8S_CA_CERT must be set together/)
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

  it.each([
    ['text that is not base64 of anything useful', 'not a certificate'],
    ['base64 of text that is not a PEM', b64('hello')],
    ['the raw PEM instead of its base64', pem],
    ['base64 of a PEM with no certificate body', b64('-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----')],
  ])('rejects a CA that is %s', (_, value) => {
    expect(() => validateEnv({ ...base, ...full, K8S_CA_CERT: value })).toThrow(/K8S_CA_CERT must be the base64 of a PEM certificate/)
  })

  it.each([
    ['token', { K8S_TOKEN: 'leak-token please' }],
    ['CA', { K8S_CA_CERT: 'leak-ca' }],
  ])('does not put the %s in an error message', (_, bad) => {
    expect(() => validateEnv({ ...base, ...full, ...bad })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('leak') as string }),
    )
  })
})

describe('SECRET_HASH_KEY', () => {
  it('is passed through', () => {
    expect(validateEnv(base).SECRET_HASH_KEY).toBe('secret_hash_key_test_0123456789abcdef')
  })

  it('accepts exactly 32 characters', () => {
    expect(validateEnv({ ...base, SECRET_HASH_KEY: 'k'.repeat(32) }).SECRET_HASH_KEY).toBe('k'.repeat(32))
  })

  it.each([undefined, '', 'k'.repeat(31), 'short'])('stops the boot when it is missing or shorter than 32 characters (%s)', (key) => {
    expect(() => validateEnv({ ...base, SECRET_HASH_KEY: key })).toThrow(/SECRET_HASH_KEY is required/)
  })

  it('stops the boot when it has whitespace, without printing the value', () => {
    const key = `${'k'.repeat(32)} leak`
    expect(() => validateEnv({ ...base, SECRET_HASH_KEY: key })).toThrow(/SECRET_HASH_KEY/)
    expect(() => validateEnv({ ...base, SECRET_HASH_KEY: key })).not.toThrow(/kkkk/)
  })
})

describe('CLUSTER_FULL_PERCENT', () => {
  it('defaults to 80 when unset or empty', () => {
    expect(validateEnv(base).CLUSTER_FULL_PERCENT).toBe(80)
    expect(validateEnv({ ...base, CLUSTER_FULL_PERCENT: '' }).CLUSTER_FULL_PERCENT).toBe(80)
  })

  it.each([['1', 1], ['65', 65], ['100', 100]])('reads %s', (value, expected) => {
    expect(validateEnv({ ...base, CLUSTER_FULL_PERCENT: value }).CLUSTER_FULL_PERCENT).toBe(expected)
  })

  it.each(['0', '101', '-1', '80.5', '80%', 'abc'])('stops on %j', (value) => {
    expect(() => validateEnv({ ...base, CLUSTER_FULL_PERCENT: value })).toThrow(/CLUSTER_FULL_PERCENT/)
  })
})
