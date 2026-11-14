import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { K8sModule } from '../k8s/k8s.module.js'
import { SecurityScanService } from '../security/security-scan.service.js'
import { SourceScanner } from '../security/source-scanner.js'
import { ReposModule } from '../repos/repos.module.js'
import { ClusterSecretWriter } from './cluster-secret-writer.js'
import { DeployConditionService } from './deploy-condition.service.js'
import { DeployEvents } from './deploy-events.js'
import { AgentClient } from './agent.client.js'
import { DeployPreparer } from './deploy-preparer.js'
import { DeployReadinessService } from './deploy-readiness.service.js'
import { DeployMetricsService } from './deploy-metrics.service.js'
import { DeployQueue } from './deploy-queue.js'
import { AgentProgress } from './agent-progress.js'
import { DeployRunsService } from './deploy-runs.service.js'
import { DeploysController } from './deploys.controller.js'
import { DeploysService } from './deploys.service.js'
import { DeploysStore } from './deploys.store.js'
import { PipelineClient } from './pipeline.client.js'
import { PipelineController } from './pipeline.controller.js'
import { PipelineTokenGuard } from './pipeline-token.guard.js'
import { SecretWriter } from './secret-writer.js'
import { SecretsService } from './secrets.service.js'
import { SlotScaleDown } from './slot-scale-down.js'

@Module({
  imports: [ConfigModule, ReposModule, K8sModule],
  controllers: [DeploysController, PipelineController],
  providers: [
    DeploysService,
    DeploysStore,
    DeployEvents,
    DeployConditionService,
    DeployRunsService,
    AgentProgress,
    DeployQueue,
    DeployMetricsService,
    SlotScaleDown,
    PipelineClient,
    AgentClient,
    PipelineTokenGuard,
    SecretsService,
    DeployReadinessService,
    // 보안 검사(UC-10, #45): 배포 입력을 저장하면 시작하고, 진행 상태가 결과를 읽는다.
    SecurityScanService,
    SourceScanner,
    // 배포 시작(#44)이 부르는 "준비됐을 때만 입력을 만든다"는 #82의 DeployReadinessService다.
    { provide: DeployPreparer, useExisting: DeployReadinessService },
    // 공간 확인 → Secret 쓰기. 클러스터 설정이 없으면 쓸 때 503 CLUSTER_UNAVAILABLE이다.
    { provide: SecretWriter, useClass: ClusterSecretWriter },
  ],
  // 게이트웨이(src/gateway)가 실행 기록 · AI 서버 연결을 같이 쓰고, verified 뒤 다시 실행을 대기열(DeployQueue)에 세운다.
  // DeployEvents: 운영 알림 모듈이 배포 결과를 학생 Discord로 보낸다.
  exports: [DeployConditionService, DeploysStore, DeployEvents, AgentClient, AgentProgress, PipelineClient, PipelineTokenGuard, SlotScaleDown, DeployQueue],
})
export class DeploysModule {}
