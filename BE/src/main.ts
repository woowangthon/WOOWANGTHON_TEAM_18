import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'
import { setupApp } from './app.setup.js'
import type { Env } from './config/env.js'
import { GatewayServer } from './gateway/gateway.server.js'

const app = await NestFactory.create(AppModule)
const config = app.get<ConfigService<Env, true>>(ConfigService)
setupApp(app, config.get('CORS_ORIGINS', { infer: true }))
await app.listen(config.get('PORT', { infer: true }))
// AI 에이전트용 MCP 게이트웨이는 공개 포트와 다른 내부 포트에서만 연다(api.md "MCP 게이트웨이").
const gatewayPort = config.get('GATEWAY_PORT', { infer: true })
if (gatewayPort !== undefined) await app.get(GatewayServer).listen(gatewayPort)
