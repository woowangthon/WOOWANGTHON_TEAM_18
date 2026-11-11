import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common'
import { AccessToken, CurrentUser } from '../auth/auth.decorators.js'
import type { AuthUser } from '../auth/auth.decorators.js'
import { DeployRunsService } from './deploy-runs.service.js'
import { DeploysService } from './deploys.service.js'

@Controller('deploys')
export class DeploysController {
  constructor(
    private readonly deploys: DeploysService,
    private readonly runs: DeployRunsService,
  ) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthUser,
    @AccessToken() accessToken: string,
    @Body() body: { repoUrl?: unknown; commit?: unknown; spec?: unknown } | undefined,
  ) {
    return this.deploys.create(user, accessToken, body?.repoUrl, body?.commit, body?.spec)
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('limit') limit: unknown) {
    return this.runs.list(user, limit)
  }

  @Post(':id/start')
  @HttpCode(202)
  start(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.runs.start(user, id)
  }

  @Get(':id/status')
  status(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.runs.status(user, id)
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.deploys.get(user, id)
  }
}
