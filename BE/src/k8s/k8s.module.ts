import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ClusterReader } from './cluster-reader.js'
import { ClusterSecrets } from './cluster-secrets.js'
import { K8sClient } from './k8s.client.js'
import { SpaceService } from './space.service.js'

@Module({
  imports: [ConfigModule],
  providers: [K8sClient, SpaceService, ClusterSecrets, ClusterReader],
  exports: [SpaceService, ClusterSecrets, ClusterReader],
})
export class K8sModule {}
