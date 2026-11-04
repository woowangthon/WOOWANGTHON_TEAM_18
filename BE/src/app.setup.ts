import type { INestApplication } from '@nestjs/common'
import { ApiExceptionFilter } from './common/api-exception.filter.js'

// main.ts와 e2e 테스트가 같이 쓴다. 테스트가 실제 앱과 같은 설정으로 돈다.
export function setupApp(app: INestApplication, corsOrigins: string[]) {
  app.setGlobalPrefix('api')
  app.useGlobalFilters(new ApiExceptionFilter())
  // 목록이 비어 있으면 어떤 origin도 허용하지 않는다.
  app.enableCors({ origin: corsOrigins })
}
