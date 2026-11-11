import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AdminController } from './admin.controller.js'
import { AdminGuard } from './admin.guard.js'
import { AdminService } from './admin.service.js'
import { AdminStore } from './admin.store.js'
import { ClusterApi, UnavailableClusterApi } from './cluster.api.js'

@Module({
  imports: [ConfigModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminStore,
    AdminGuard,
    // 리더 연결(#81, PR #106의 K8sClient가 get · patch를 갖추면)로 바꾼다.
    { provide: ClusterApi, useClass: UnavailableClusterApi },
  ],
})
export class AdminModule {}
