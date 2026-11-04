import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { setupApp } from '../src/app.setup.js'

// main.ts와 같은 모듈 · 설정으로 앱을 띄운다. 닫는 것은 부른 쪽이 한다.
export async function startApp(corsOrigins: string[] = []): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  const app = moduleRef.createNestApplication<INestApplication<App>>()
  setupApp(app, corsOrigins)
  await app.init()
  return app
}
