import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { afterEach, describe, expect, it } from 'vitest'
import { startApp } from './start-app.js'

let app: INestApplication<App>

async function start(corsOrigins: string[] = []) {
  app = await startApp(corsOrigins)
  return request(app.getHttpServer())
}

afterEach(async () => {
  await app.close()
})

it('GET /api/health answers ok without a login token', async () => {
  const http = await start()
  await http.get('/api/health').expect(200, { status: 'ok' })
})

it('routes live under /api only', async () => {
  const http = await start()
  await http.get('/health').expect(404)
})

it('answers an unknown route in the common error shape', async () => {
  const http = await start()
  await http.get('/api/nope').expect(404, { error: { code: 'NOT_FOUND', message: 'Cannot GET /api/nope' } })
})

describe('CORS', () => {
  const allowed = 'http://allowed.test'

  it('echoes an allowed origin', async () => {
    const http = await start([allowed])
    const res = await http.get('/api/health').set('Origin', allowed).expect(200)
    expect(res.headers['access-control-allow-origin']).toBe(allowed)
  })

  it('does not allow an origin outside the list', async () => {
    const http = await start([allowed])
    const res = await http.get('/api/health').set('Origin', 'http://evil.test').expect(200)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('allows no origin when the list is empty', async () => {
    const http = await start()
    const res = await http.get('/api/health').set('Origin', allowed).expect(200)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})
