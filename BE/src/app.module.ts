import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AuthModule } from './auth/auth.module.js'
import { validateEnv } from './config/env.js'
import { HealthController } from './health/health.controller.js'
import { ReposModule } from './repos/repos.module.js'

@Module({
  imports: [ConfigModule.forRoot({ validate: validateEnv }), AuthModule, ReposModule],
  controllers: [HealthController],
})
export class AppModule {}
