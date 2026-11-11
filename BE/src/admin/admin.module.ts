import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AdminController } from './admin.controller.js'
import { AdminGuard } from './admin.guard.js'
import { AdminService } from './admin.service.js'
import { AdminStore } from './admin.store.js'
import { K8sModule } from '../k8s/k8s.module.js'
import { DeploymentScaler, UnwiredDeploymentScaler } from './deployment-scaler.js'

@Module({
  imports: [ConfigModule, K8sModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminStore,
    AdminGuard,
    // 읽기는 K8sModule의 ClusterReader. 쓰기(scale)는 서버 계정에 권한이 생길 때까지 붙이지 않는다.
    { provide: DeploymentScaler, useClass: UnwiredDeploymentScaler },
  ],
})
export class AdminModule {}
