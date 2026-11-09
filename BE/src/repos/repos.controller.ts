import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { AccessToken } from '../auth/auth.decorators.js'
import { ReposService } from './repos.service.js'

@Controller('repos')
export class ReposController {
  constructor(private readonly repos: ReposService) {}

  @Post('check')
  @HttpCode(200)
  check(@AccessToken() accessToken: string, @Body() body: { repoUrl?: unknown } | undefined) {
    return this.repos.check(accessToken, body?.repoUrl)
  }

  @Post('dockerfiles')
  @HttpCode(200)
  dockerfiles(@AccessToken() accessToken: string, @Body() body: { repoUrl?: unknown } | undefined) {
    return this.repos.dockerfiles(accessToken, body?.repoUrl)
  }

  @Post('deploy-spec')
  @HttpCode(200)
  deploySpec(@AccessToken() accessToken: string, @Body() body: { repoUrl?: unknown } | undefined) {
    return this.repos.deploySpec(accessToken, body?.repoUrl)
  }
}
