import { describe, expect, it } from 'vitest'
import { validateEnv } from './env.js'

describe('PORT', () => {
  it('defaults to 3000 when unset or empty', () => {
    expect(validateEnv({}).PORT).toBe(3000)
    expect(validateEnv({ PORT: '' }).PORT).toBe(3000)
  })

  it('parses an integer in range', () => {
    expect(validateEnv({ PORT: '1' }).PORT).toBe(1)
    expect(validateEnv({ PORT: '65535' }).PORT).toBe(65535)
  })

  it.each(['abc', '0', '65536', '3000.5', '-1', ' 3000', '1e3'])('rejects "%s"', (port) => {
    expect(() => validateEnv({ PORT: port })).toThrow(/PORT/)
  })
})

describe('CORS_ORIGINS', () => {
  it('is empty (no other origin allowed) when unset or empty', () => {
    expect(validateEnv({}).CORS_ORIGINS).toEqual([])
    expect(validateEnv({ CORS_ORIGINS: '' }).CORS_ORIGINS).toEqual([])
  })

  it('splits on commas, trims, and skips empty entries', () => {
    expect(
      validateEnv({ CORS_ORIGINS: ' https://a.example , http://localhost:5173,' }).CORS_ORIGINS,
    ).toEqual(['https://a.example', 'http://localhost:5173'])
  })

  it.each(['*', 'a.example', 'https://a.example/', 'https://a.example/app', 'null'])(
    'rejects "%s"',
    (origin) => {
      expect(() => validateEnv({ CORS_ORIGINS: origin })).toThrow(/CORS_ORIGINS/)
    },
  )
})
