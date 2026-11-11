import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ReposModule } from '../repos/repos.module.js'
import { DeployConditionService } from './deploy-condition.service.js'
import { DeploysController } from './deploys.controller.js'
import { DeploysService } from './deploys.service.js'
import { DeploysStore } from './deploys.store.js'
import { SecretWriter, UnavailableSecretWriter } from './secret-writer.js'
import { SecretsService } from './secrets.service.js'

@Module({
  imports: [ConfigModule, ReposModule],
  controllers: [DeploysController],
  // SecretWriter의 실제 구현은 클러스터 호출 모듈(#111)이 묶는다. 그 전에는 쓰지 못한다고 답한다.
  providers: [DeploysService, DeploysStore, DeployConditionService, SecretsService, { provide: SecretWriter, useClass: UnavailableSecretWriter }],
  exports: [DeployConditionService],
})
export class DeploysModule {}
