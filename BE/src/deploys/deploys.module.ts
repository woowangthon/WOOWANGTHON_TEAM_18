import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ReposModule } from '../repos/repos.module.js'
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
import { SecretWriter, UnavailableSecretWriter } from './secret-writer.js'
import { SecretsService } from './secrets.service.js'

@Module({
  imports: [ConfigModule, ReposModule],
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
    // SecretWriter의 실제 구현은 클러스터 호출 모듈(#111, #118)이 묶는다. 그 전에는 쓰지 못한다고 답한다.
    { provide: SecretWriter, useClass: UnavailableSecretWriter },
  ],
  exports: [DeployConditionService],
})
export class DeploysModule {}
