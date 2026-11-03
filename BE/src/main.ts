import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'
import { setupApp } from './app.setup.js'
import type { Env } from './config/env.js'

const app = await NestFactory.create(AppModule)
const config = app.get<ConfigService<Env, true>>(ConfigService)
setupApp(app, config.get('CORS_ORIGINS', { infer: true }))
await app.listen(config.get('PORT', { infer: true }))
