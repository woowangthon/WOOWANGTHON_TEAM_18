import { describe, expect, it } from 'vitest'
import { validateEnv } from './env.js'

// 필수값만 채운 입력. 각 테스트는 보려는 값만 덮어쓴다.
const base = { SUPABASE_URL: 'https://abc.supabase.co' }

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

describe('SUPABASE_URL', () => {
  it('accepts a project origin', () => {
    expect(validateEnv(base).SUPABASE_URL).toBe('https://abc.supabase.co')
    expect(validateEnv({ SUPABASE_URL: 'http://127.0.0.1:54321' }).SUPABASE_URL).toBe('http://127.0.0.1:54321')
  })

  it.each([undefined, ''])('is required (%s)', (url) => {
    expect(() => validateEnv({ SUPABASE_URL: url })).toThrow(/SUPABASE_URL is required/)
  })

  it.each(['abc.supabase.co', 'https://abc.supabase.co/', 'https://abc.supabase.co/auth/v1'])(
    'rejects "%s"',
    (url) => {
      expect(() => validateEnv({ SUPABASE_URL: url })).toThrow(/SUPABASE_URL .* is not an origin/)
    },
  )
})
