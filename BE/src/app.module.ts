import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { validateEnv } from './config/env.js'
import { HealthController } from './health/health.controller.js'

@Module({
  imports: [ConfigModule.forRoot({ validate: validateEnv })],
  controllers: [HealthController],
})
export class AppModule {}
