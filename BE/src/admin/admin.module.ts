import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AdminController } from './admin.controller.js'
import { AdminGuard } from './admin.guard.js'
import { AdminService } from './admin.service.js'
import { AdminStore } from './admin.store.js'
import { K8sModule } from '../k8s/k8s.module.js'

@Module({
  imports: [ConfigModule, K8sModule],
  controllers: [AdminController],
  // 읽기(ClusterReader)와 쓰기(DeploymentScaler)는 K8sModule이 준다.
  providers: [AdminService, AdminStore, AdminGuard],
})
export class AdminModule {}
