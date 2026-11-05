import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { AuthGuard } from './auth.guard.js'
import { MeController } from './me.controller.js'

@Module({
  imports: [ConfigModule],
  controllers: [MeController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
