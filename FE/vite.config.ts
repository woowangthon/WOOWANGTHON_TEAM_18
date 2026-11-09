import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 개발 서버에서 /api를 BE로 넘겨 CORS 없이 부른다. 3000은 BE의 기본 포트이고,
    // BE의 PORT를 바꾸면 여기도 고쳐야 한다.
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // supabase.ts는 값이 비면 import 시점에 오류를 던진다. CI에는 FE/.env가 없고 로컬에는 실제 값이 있으므로,
    // 화면을 그리는 테스트가 어느 쪽에도 좌우되지 않게 항상 가짜 값을 넣는다. 실제 서버를 부르는 테스트는 없다.
    env: {
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    },
  },
})
