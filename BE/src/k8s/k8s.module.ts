import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ClusterCapacity } from './cluster-capacity.js'
import { ClusterReader } from './cluster-reader.js'
import { ClusterSecrets } from './cluster-secrets.js'
import { DeploymentScaler } from './deployment-scaler.js'
import { K8sClient } from './k8s.client.js'
import { SpaceService } from './space.service.js'

@Module({
  imports: [ConfigModule],
  providers: [K8sClient, SpaceService, ClusterSecrets, ClusterReader, ClusterCapacity, DeploymentScaler],
  exports: [SpaceService, ClusterSecrets, ClusterReader, ClusterCapacity, DeploymentScaler],
})
export class K8sModule {}
