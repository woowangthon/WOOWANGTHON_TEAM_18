import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AuthModule } from './auth/auth.module.js'
import { validateEnv } from './config/env.js'
import { HealthController } from './health/health.controller.js'

@Module({
  imports: [ConfigModule.forRoot({ validate: validateEnv }), AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
