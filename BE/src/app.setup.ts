import type { INestApplication } from '@nestjs/common'

// main.ts와 e2e 테스트가 같이 쓴다. 테스트가 실제 앱과 같은 설정으로 돈다.
export function setupApp(app: INestApplication) {
  app.setGlobalPrefix('api')
}
