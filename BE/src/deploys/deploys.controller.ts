import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common'
import { AccessToken, CurrentUser } from '../auth/auth.decorators.js'
import type { AuthUser } from '../auth/auth.decorators.js'
import { DeploysService } from './deploys.service.js'

@Controller('deploys')
export class DeploysController {
  constructor(private readonly deploys: DeploysService) {}

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
}
