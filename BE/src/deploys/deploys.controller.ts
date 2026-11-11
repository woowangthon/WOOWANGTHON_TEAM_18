import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common'
import { AccessToken, CurrentUser } from '../auth/auth.decorators.js'
import type { AuthUser } from '../auth/auth.decorators.js'
import { DeploysService } from './deploys.service.js'
import { SecretsService } from './secrets.service.js'

@Controller('deploys')
export class DeploysController {
  constructor(
    private readonly deploys: DeploysService,
    private readonly secrets: SecretsService,
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

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.deploys.get(user, id)
  }

  @Put(':id/secrets')
  putSecrets(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.secrets.put(user, id, body)
  }

  @Get(':id/secrets')
  getSecrets(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.secrets.status(user, id)
  }
}
