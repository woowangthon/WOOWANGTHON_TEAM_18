import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { afterAll, beforeAll, it } from 'vitest'
import { AppModule } from '../src/app.module.js'
import { setupApp } from '../src/app.setup.js'

let app: INestApplication<App>

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication()
  setupApp(app)
  await app.init()
})

afterAll(async () => {
  await app.close()
})

it('GET /api/health answers ok', async () => {
  await request(app.getHttpServer()).get('/api/health').expect(200, { status: 'ok' })
})

it('routes live under /api only', async () => {
  await request(app.getHttpServer()).get('/health').expect(404)
})
