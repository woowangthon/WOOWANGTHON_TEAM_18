import type { INestApplication } from '@nestjs/common'
import { ApiExceptionFilter } from './common/api-exception.filter.js'

// main.ts와 e2e 테스트가 같이 쓴다. 테스트가 실제 앱과 같은 설정으로 돈다.
export function setupApp(app: INestApplication, corsOrigins: string[]) {
  app.setGlobalPrefix('api')
  app.useGlobalFilters(new ApiExceptionFilter())
  // 목록이 비어 있으면 어떤 origin도 허용하지 않는다.
  // maxAge: 브라우저가 사전 요청(OPTIONS) 결과를 기억하는 초. 없으면 Chromium은 5초만 기억해서 인증이 붙은 요청마다 왕복이 한 번 더 든다.
  // Chromium은 7200(2시간)까지만 받아들인다.
  app.enableCors({ origin: corsOrigins, maxAge: 7200 })
}
