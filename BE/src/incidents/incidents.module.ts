import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { DeploysModule } from '../deploys/deploys.module.js'
import { K8sModule } from '../k8s/k8s.module.js'
import { AlertWatcher } from './alert-watcher.js'
import { DeployResultNotifier } from './deploy-result.notifier.js'
import { DiscordNotifier } from './discord.notifier.js'
import { IncidentJudge } from './incident-judge.js'
import { AdminIncidentsController, IncidentsController } from './incidents.controller.js'
import { IncidentsStore } from './incidents.store.js'

/** 운영 알림(스파이크 감지 → AI 판단 → 알림, docs/design/incidents.md)과 배포 결과의 학생 Discord. */
@Module({
  imports: [ConfigModule, K8sModule, DeploysModule],
  controllers: [AdminIncidentsController, IncidentsController],
  providers: [AlertWatcher, IncidentsStore, IncidentJudge, DiscordNotifier, DeployResultNotifier],
})
export class IncidentsModule {}
