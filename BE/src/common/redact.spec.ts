import { describe, expect, it } from 'vitest'
import { REDACTED, redact, redactString } from './redact.js'

const GH = `ghp_${'a'.repeat(36)}`
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop'

describe('redactString', () => {
  it.each([
    ['a GitHub token', `clone https://x/${GH} failed`, GH],
    ['a fine-grained GitHub token', `token github_pat_${'A1_'.repeat(10)}`, 'github_pat_'],
    ['an sk- key', `key is sk-${'x'.repeat(30)}`, `sk-${'x'.repeat(30)}`],
    ['an AWS access key id', 'AKIAABCDEFGHIJKLMNOP in env', 'AKIAABCDEFGHIJKLMNOP'],
    ['a JWT', `session ${JWT}`, JWT],
    ['a Supabase secret key', 'sb_secret_abc123_DEF', 'sb_secret_abc123_DEF'],
    ['a bearer header', 'Authorization: Bearer abcdefgh12345678', 'abcdefgh12345678'],
    ['a URL password', 'postgres://admin:hunter2pass@db.example.com:5432/app', 'hunter2pass'],
    ['a NAME=value line', 'DATABASE_URL=postgres://u@h/db', 'postgres://u@h/db'],
    ['an API_KEY line', 'export STRIPE_API_KEY=whatever123', 'whatever123'],
    ['a quoted JSON value', '{"password": "p@ss w0rd"}', 'p@ss w0rd'],
    ['a private key block', '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----', 'MIIabc'],
  ])('hides %s', (_name, input, secret) => {
    const out = redactString(input)
    expect(out).not.toContain(secret)
    expect(out).toContain(REDACTED)
  })

  it('leaves ordinary text alone', () => {
    const text = 'deployment "be-b" exceeded its progress deadline (port 3000, image ghcr.io/x/student-apps)'
    expect(redactString(text)).toBe(text)
  })
})

describe('redact', () => {
  it('hides the value of a sensitive key and keeps the rest', () => {
    expect(redact({ name: 'be', apiKey: 'abc', nested: { token: 'zzz', port: 3000 } })).toEqual({
      name: 'be',
      apiKey: REDACTED,
      nested: { token: REDACTED, port: 3000 },
    })
  })

  it('hides the value of a Pod env entry whose name is sensitive', () => {
    const pod = { spec: { containers: [{ env: [{ name: 'DB_PASSWORD', value: 'hunter2' }, { name: 'NODE_ENV', value: 'production' }] }] } }
    expect(redact(pod)).toEqual({
      spec: { containers: [{ env: [{ name: 'DB_PASSWORD', value: REDACTED }, { name: 'NODE_ENV', value: 'production' }] }] },
    })
  })

  it('hides every value of a k8s Secret', () => {
    expect(redact({ kind: 'Secret', metadata: { name: 'be-secrets' }, data: { A: 'Zm9v' }, stringData: { B: 'bar' } })).toEqual({
      kind: 'Secret',
      metadata: { name: 'be-secrets' },
      data: REDACTED,
      stringData: REDACTED,
    })
  })

  it('walks arrays, keeps null and numbers, and does not change the input', () => {
    const input = { lines: [`token ${GH}`, null, 3], secret: null }
    const out = redact(input) as { lines: unknown[]; secret: unknown }
    expect(out.lines[0]).not.toContain(GH)
    expect(out.lines.slice(1)).toEqual([null, 3])
    expect(out.secret).toBeNull()
    expect(input.lines[0]).toContain(GH)
  })
})
