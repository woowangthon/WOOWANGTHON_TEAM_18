import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { DeployEvents } from '../deploys/deploy-events.js'
import { toFailure } from '../deploys/deploy-run.js'
import { toAgent } from '../deploys/deploy-runs.service.js'
import { type DeployRunRow, DeploysStore } from '../deploys/deploys.store.js'
import { DiscordNotifier } from './discord.notifier.js'
import { IncidentsStore } from './incidents.store.js'

/** 배포 결과 한 줄(학생 Discord). 자세한 내용은 "내 배포" 화면에 있다. */
export function deployMessage(run: Pick<DeployRunRow, 'slug' | 'status' | 'failure' | 'agent_result'>): string {
  const head = `[${run.slug}]`
  // "내 배포" 화면과 같은 방식으로 AI 결과를 읽는다.
  const agent = run.agent_result ? toAgent(run.agent_result) : null
  if (run.status === 'succeeded') return `${head} 배포를 마쳤어요.`
  if (run.status === 'needs_user') {
    if (agent?.prUrl) return `${head} AI가 고친 PR을 열었어요: ${agent.prUrl}\n머지한 뒤 다시 배포해 주세요.`
    const ask = agent?.userRequest?.message.trim()
    return [`${head} 배포를 이어 가려면 확인이 필요해요.`, ...(ask ? [ask] : [])].join('\n')
  }
  const failure = run.failure ? toFailure(run.failure) : null
  const summary = agent?.summary.trim()
  return [
    `${head} 배포하지 못했어요${failure ? ` (${failure.stage} · ${failure.code})` : ''}.`,
    ...(failure ? [failure.message] : []),
    ...(summary ? [`AI: ${summary}`] : []),
  ].join('\n')
}

/**
 * 배포가 끝나면(성공 · 실패 · 학생 확인 필요) 학생이 넣은 Discord 웹후크로 한 줄 보낸다(넣지 않았으면 보내지 않는다). 운영자 채널에는 보내지 않는다.
 * 보내기는 배포를 막지 않게 따로 돌고, 실패하면 로그만 남긴다.
 */
@Injectable()
export class DeployResultNotifier implements OnModuleInit {
  private readonly logger = new Logger(DeployResultNotifier.name)

  constructor(
    private readonly events: DeployEvents,
    private readonly deploys: DeploysStore,
    private readonly store: IncidentsStore,
    private readonly discord: DiscordNotifier,
  ) {}

  onModuleInit(): void {
    this.events.onEnded((deployId) => void this.notify(deployId))
  }

  async notify(deployId: string): Promise<void> {
    try {
      const run = await this.deploys.findRun(deployId)
      if (!run) return
      await this.discord.toStudent(await this.store.webhook(run.user_id), deployMessage(run))
    } catch (err) {
      this.logger.warn(`deploy result not sent: ${err instanceof Error ? err.name : 'error'}`)
    }
  }
}
