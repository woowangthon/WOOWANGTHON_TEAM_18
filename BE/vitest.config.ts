import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // ConfigModule이 import될 때 env를 검증하므로 필수값을 테스트 시작 전에 넣는다. 가짜 값이라 네트워크로 나가지 않는다.
    env: {
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      SUPABASE_SECRET_KEY: 'sb_secret_test',
      SECRET_HASH_KEY: 'secret_hash_key_test_0123456789abcdef',
      GOCD_URL: 'https://gocd.test',
      GOCD_TOKEN: 'gocd_token_test',
      GOCD_PIPELINE: 'student-deploy',
      PIPELINE_NOTIFY_TOKEN: 'pipeline_notify_test_0123456789abcdef',
      AI_SERVER_URL: 'https://ai.test',
      AGENT_API_TOKEN: 'agent_token_test',
      // 운영 알림 테스트(test/incidents.e2e.spec.ts)가 가짜 fetch로 받는다. 감시기는 시험에서 스스로 돌지 않는다(K8S_* 없음).
      DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/111/operator-token',
      // 기본은 토큰 없이 부른다. 개발 기기 · CI의 셸에 GITHUB_TOKEN이 있어도 시험이 그 값을 쓰지 않게 비운다(토큰 시험은 vi.stubEnv로 넣는다).
      GITHUB_TOKEN: '',
    },
  },
})
