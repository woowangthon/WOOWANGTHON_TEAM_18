import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { DeploysModule } from '../deploys/deploys.module.js'
import { K8sModule } from '../k8s/k8s.module.js'
import { GatewayServer } from './gateway.server.js'
import { RepoReader } from './repo-reader.js'
import { GatewayTickets } from './tickets.js'
import { GatewayTools } from './tools.js'
import { TrialsController } from './trials.controller.js'
import { GatewayTrials } from './trials.js'

/** AI 에이전트용 MCP 게이트웨이(api.md "MCP 게이트웨이"). main.ts가 GATEWAY_PORT에서 연다. 시험 파이프라인의 입력 · 결과 라우트(/api/pipeline/trials)도 여기 있다. */
@Module({
  imports: [ConfigModule, DeploysModule, K8sModule],
  controllers: [TrialsController],
  providers: [GatewayServer, GatewayTickets, GatewayTools, GatewayTrials, RepoReader],
  exports: [GatewayServer],
})
export class GatewayModule {}
