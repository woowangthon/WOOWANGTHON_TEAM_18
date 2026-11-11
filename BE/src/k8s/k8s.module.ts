import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { K8sClient } from './k8s.client.js'
import { SpaceService } from './space.service.js'

@Module({
  imports: [ConfigModule],
  providers: [K8sClient, SpaceService],
  exports: [SpaceService],
})
export class K8sModule {}
