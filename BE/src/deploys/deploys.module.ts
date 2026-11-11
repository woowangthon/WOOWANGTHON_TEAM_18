import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ReposModule } from '../repos/repos.module.js'
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
    // #82가 준비 상태를 확인하는 구현으로 바꾼다.
    { provide: DeployPreparer, useClass: UnavailableDeployPreparer },
  ],
  exports: [DeployConditionService],
})
export class DeploysModule {}
