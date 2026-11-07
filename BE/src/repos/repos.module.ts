import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ReposController } from './repos.controller.js'
import { ReposService } from './repos.service.js'

@Module({
  imports: [ConfigModule],
  controllers: [ReposController],
  providers: [ReposService],
})
export class ReposModule {}
