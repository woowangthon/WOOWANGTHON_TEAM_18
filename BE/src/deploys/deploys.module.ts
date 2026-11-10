import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ReposModule } from '../repos/repos.module.js'
import { DeploysController } from './deploys.controller.js'
import { DeploysService } from './deploys.service.js'
import { DeploysStore } from './deploys.store.js'

@Module({
  imports: [ConfigModule, ReposModule],
  controllers: [DeploysController],
  providers: [DeploysService, DeploysStore],
})
export class DeploysModule {}
