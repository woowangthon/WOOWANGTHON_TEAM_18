import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// 모듈이 import 시점에 환경 변수를 읽으므로 케이스마다 모듈을 새로 불러온다.
// 두 값을 항상 직접 지정해 FE/.env의 실제 값에 테스트 결과가 좌우되지 않게 한다.
const TEST_URL = 'https://example.supabase.co'
const TEST_KEY = 'sb_publishable_test'

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

it('creates a client when both settings are present', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', TEST_URL)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', TEST_KEY)

  const { supabase } = await import('./supabase.ts')

  expect(typeof supabase.auth.signInWithPassword).toBe('function')
})

it.each(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'])(
  'throws an error naming %s when it is empty',
  async (name) => {
    vi.stubEnv('VITE_SUPABASE_URL', TEST_URL)
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', TEST_KEY)
    vi.stubEnv(name, '')

    await expect(import('./supabase.ts')).rejects.toThrow(name)
  },
)
