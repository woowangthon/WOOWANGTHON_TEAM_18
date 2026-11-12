import type { ConfigService } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Env, validateEnv } from '../src/config/env.js'

// `.env.example`를 그대로 복사하면 선택 키가 `KEY=`(빈 값)로 들어온다. 앱은 검증한 값만 읽어야 한다(빈 값 = 설정 안 함, undefined).
// ConfigModule은 import될 때 env를 읽으므로, 환경을 바꾼 뒤 앱 모듈을 새로 불러온다.

// 선택 키 = 필수값만 있을 때 validateEnv가 undefined로 두는 키. 목록을 손으로 적지 않아서, 선택 키를 새로 더하면 이 시험이 그 키도 같이 본다.
const REQUIRED = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  SECRET_HASH_KEY: 'secret_hash_key_test_0123456789abcdef',
}
const OPTIONAL = Object.entries(validateEnv(REQUIRED))
  .filter(([, value]) => value === undefined)
  .map(([name]) => name as keyof Env)

const booted: TestingModule[] = []

async function configWith(env: Record<string, string>): Promise<ConfigService<Env, true>> {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  vi.resetModules()
  const { AppModule } = await import('../src/app.module.js')
  const { ConfigService: Service } = await import('@nestjs/config')
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  booted.push(moduleRef)
  return moduleRef.get<ConfigService<Env, true>>(Service)
}

describe('optional settings left empty (a copied .env.example)', () => {
  afterEach(async () => {
    await Promise.all(booted.splice(0).map((moduleRef) => moduleRef.close()))
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('every optional setting set to "" is read as not set (undefined), not as an empty string', async () => {
    expect(OPTIONAL.length).toBeGreaterThan(0)
    const config = await configWith(Object.fromEntries(OPTIONAL.map((name) => [name, ''])))
    for (const name of OPTIONAL) expect(config.get(name, { infer: true }), name).toBeUndefined()
  })

  it('a value that is set is still read (the fix must not turn the optional settings off)', async () => {
    const config = await configWith({ GATEWAY_PORT: '4001', GOCD_URL: 'https://gocd.example.com' })
    expect(config.get('GATEWAY_PORT', { infer: true })).toBe(4001)
    expect(config.get('GOCD_URL', { infer: true })).toBe('https://gocd.example.com')
  })
})
