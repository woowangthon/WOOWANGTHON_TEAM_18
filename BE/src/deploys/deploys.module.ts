import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { K8sModule } from '../k8s/k8s.module.js'
import { ReposModule } from '../repos/repos.module.js'
import { ClusterSecretWriter } from './cluster-secret-writer.js'
import { DeployConditionService } from './deploy-condition.service.js'
import { AgentClient } from './agent.client.js'
import { DeployPreparer, UnavailableDeployPreparer } from './deploy-preparer.js'
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
    // #82가 준비 상태를 확인하는 구현으로 바꾼다.
    { provide: DeployPreparer, useClass: UnavailableDeployPreparer },
    // 공간 확인 → Secret 쓰기. 클러스터 설정이 없으면 쓸 때 503 CLUSTER_UNAVAILABLE이다.
    { provide: SecretWriter, useClass: ClusterSecretWriter },
  ],
  exports: [DeployConditionService],
})
export class DeploysModule {}
