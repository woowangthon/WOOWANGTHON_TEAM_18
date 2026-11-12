import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common'
import { Public } from '../auth/auth.decorators.js'
import { PipelineTokenGuard } from '../deploys/pipeline-token.guard.js'
import { GatewayTrials } from './trials.js'

// 시험 파이프라인(student-trial)이 부르는 기계용 라우트(api.md "파이프라인 ↔ 플랫폼 서버" 4번). 배포 알림과 같은 PIPELINE_NOTIFY_TOKEN으로만 받는다.
@Public()
@UseGuards(PipelineTokenGuard)
@Controller('pipeline/trials')
export class TrialsController {
  constructor(private readonly trials: GatewayTrials) {}

  @Get(':trialId/input')
  input(@Param('trialId') trialId: string, @Query('counter') counter: unknown) {
    return this.trials.input(trialId, counter)
  }

  @Post(':trialId/result')
  @HttpCode(200)
  result(@Param('trialId') trialId: string, @Body() body: unknown) {
    return this.trials.result(trialId, body)
  }
}
