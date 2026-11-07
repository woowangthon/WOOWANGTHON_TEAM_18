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
}
