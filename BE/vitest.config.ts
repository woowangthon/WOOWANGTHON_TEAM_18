import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // ConfigModule이 import될 때 env를 검증하므로 필수값을 테스트 시작 전에 넣는다. 가짜 값이라 네트워크로 나가지 않는다.
    env: {
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      SUPABASE_SECRET_KEY: 'sb_secret_test',
      GOCD_URL: 'https://gocd.test',
      GOCD_TOKEN: 'gocd_token_test',
      GOCD_PIPELINE: 'student-deploy',
      PIPELINE_NOTIFY_TOKEN: 'pipeline_notify_test_0123456789abcdef',
      AI_SERVER_URL: 'https://ai.test',
      AGENT_API_TOKEN: 'agent_token_test',
    },
  },
})
