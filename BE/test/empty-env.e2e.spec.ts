import type { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Env, validateEnv } from '../src/config/env.js'

// `.env.example`를 그대로 복사하면 선택 키가 `KEY=`(빈 값)로 들어온다. 검증(`validateEnv`)은 빈 값을 "설정 안 함"(undefined)으로 읽는데,
// ConfigService.get은 검증된 값이 undefined면 process.env의 ''로 돌아가 "설정함"으로 읽는 일이 있었다(GATEWAY_PORT=''로 게이트웨이를 열다 부팅이 죽었다).
// 앱은 검증된 값만 읽어야 한다. ConfigModule은 import될 때 env를 읽으므로, 환경을 바꾼 뒤 앱 모듈을 새로 불러온다.

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

async function configWith(env: Record<string, string>): Promise<{ config: ConfigService<Env, true>; close: () => Promise<void> }> {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  vi.resetModules()
  const { AppModule } = await import('../src/app.module.js')
  const { ConfigService: Service } = await import('@nestjs/config')
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  return { config: moduleRef.get<ConfigService<Env, true>>(Service), close: () => moduleRef.close() }
}

describe('optional settings left empty (a copied .env.example)', () => {
  let close: (() => Promise<void>) | undefined
  beforeEach(() => {
    close = undefined
  })
  afterEach(async () => {
    await close?.()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('there are optional settings to check (the list comes from validateEnv)', () => {
    expect(OPTIONAL).toEqual(expect.arrayContaining(['GATEWAY_PORT', 'GOCD_URL', 'K8S_API_URL']))
  })

  it.each(OPTIONAL)('%s="" is read as not set (undefined), not as an empty string', async (name) => {
    const app = await configWith({ [name]: '' })
    close = app.close
    expect(app.config.get(name, { infer: true })).toBeUndefined()
  })

  it('all optional settings empty together: the app boots and every one is not set', async () => {
    const app = await configWith(Object.fromEntries(OPTIONAL.map((name) => [name, ''])))
    close = app.close
    for (const name of OPTIONAL) expect(app.config.get(name, { infer: true }), name).toBeUndefined()
  })

  it('PORT="" and CORS_ORIGINS="" still give their defaults', async () => {
    const app = await configWith({ PORT: '', CORS_ORIGINS: '' })
    close = app.close
    expect(app.config.get('PORT', { infer: true })).toBe(3000)
    expect(app.config.get('CORS_ORIGINS', { infer: true })).toEqual([])
  })

  it('a value that is set is still read (the fix must not turn the optional settings off)', async () => {
    const app = await configWith({ GATEWAY_PORT: '4001', GOCD_URL: 'https://gocd.example.com' })
    close = app.close
    expect(app.config.get('GATEWAY_PORT', { infer: true })).toBe(4001)
    expect(app.config.get('GOCD_URL', { infer: true })).toBe('https://gocd.example.com')
  })

  it('a setting that is not in the process env at all is not set either', async () => {
    vi.stubEnv('GATEWAY_PORT', undefined)
    const app = await configWith({})
    close = app.close
    expect(app.config.get('GATEWAY_PORT', { infer: true })).toBeUndefined()
  })
})
