import { Module } from '@nestjs/common'
import { DeploysModule } from '../deploys/deploys.module.js'
import { K8sModule } from '../k8s/k8s.module.js'
import { GatewayServer } from './gateway.server.js'
import { RepoReader } from './repo-reader.js'
import { GatewayTickets } from './tickets.js'
import { GatewayTools } from './tools.js'

/** AI 에이전트용 MCP 게이트웨이(api.md "MCP 게이트웨이"). main.ts가 GATEWAY_PORT에서 연다. */
@Module({
  imports: [DeploysModule, K8sModule],
  providers: [GatewayServer, GatewayTickets, GatewayTools, RepoReader],
  exports: [GatewayServer],
})
export class GatewayModule {}
