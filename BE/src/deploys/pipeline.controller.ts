import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { Public } from '../auth/auth.decorators.js'
import { DeployRunsService } from './deploy-runs.service.js'
import { PipelineTokenGuard } from './pipeline-token.guard.js'

// 사용자 로그인이 아니라 기계용 토큰으로만 부른다(전역 로그인 가드는 건너뛰고 PipelineTokenGuard가 막는다).
@Public()
@UseGuards(PipelineTokenGuard)
@Controller('pipeline')
export class PipelineController {
  constructor(private readonly runs: DeployRunsService) {}

  @Get('deploys/:deployId/input')
  input(@Param('deployId') deployId: string) {
    return this.runs.pipelineInput(deployId)
  }

  @Post('notify')
  @HttpCode(200)
  notify(@Body() body: unknown) {
    return this.runs.notify(body)
  }
}
