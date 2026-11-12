import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { K8sModule } from '../k8s/k8s.module.js'
import { ReposModule } from '../repos/repos.module.js'
import { ClusterSecretWriter } from './cluster-secret-writer.js'
import { DeployConditionService } from './deploy-condition.service.js'
import { AgentClient } from './agent.client.js'
import { DeployPreparer } from './deploy-preparer.js'
import { DeployReadinessService } from './deploy-readiness.service.js'
import { DeployRunsService } from './deploy-runs.service.js'
import { DeploysController } from './deploys.controller.js'
import { DeploysService } from './deploys.service.js'
import { DeploysStore } from './deploys.store.js'
import { PipelineClient } from './pipeline.client.js'
import { PipelineController } from './pipeline.controller.js'
import { PipelineTokenGuard } from './pipeline-token.guard.js'
import { SecretWriter } from './secret-writer.js'
import { SecretsService } from './secrets.service.js'

@Module({
  imports: [ConfigModule, ReposModule, K8sModule],
  controllers: [DeploysController, PipelineController],
  providers: [
    DeploysService,
    DeploysStore,
    DeployConditionService,
    DeployRunsService,
    PipelineClient,
    AgentClient,
    PipelineTokenGuard,
    SecretsService,
    DeployReadinessService,
    // 배포 시작(#44)이 부르는 "준비됐을 때만 입력을 만든다"는 #82의 DeployReadinessService다.
    { provide: DeployPreparer, useExisting: DeployReadinessService },
    // 공간 확인 → Secret 쓰기. 클러스터 설정이 없으면 쓸 때 503 CLUSTER_UNAVAILABLE이다.
    { provide: SecretWriter, useClass: ClusterSecretWriter },
  ],
  // 게이트웨이(src/gateway)가 실행 기록 · AI 서버 연결을 같이 쓴다.
  exports: [DeployConditionService, DeploysStore, AgentClient],
})
export class DeploysModule {}
