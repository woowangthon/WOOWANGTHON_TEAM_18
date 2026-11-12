import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AdminModule } from './admin/admin.module.js'
import { AuthModule } from './auth/auth.module.js'
import { validateEnv } from './config/env.js'
import { DeploysModule } from './deploys/deploys.module.js'
import { GatewayModule } from './gateway/gateway.module.js'
import { HealthController } from './health/health.controller.js'
import { ReposModule } from './repos/repos.module.js'

@Module({
  // skipProcessEnv: 검증한 값(validateEnv)만 읽는다. 켜지 않으면 `KEY=`로 비운 선택 키를 process.env의 ''로 다시 읽어 "설정함"이 된다.
  imports: [ConfigModule.forRoot({ validate: validateEnv, skipProcessEnv: true }), AuthModule, ReposModule, DeploysModule, AdminModule, GatewayModule],
  controllers: [HealthController],
})
export class AppModule {}
