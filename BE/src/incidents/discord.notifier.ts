import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DISCORD_WEBHOOK, type Env } from '../config/env.js'

const TIMEOUT_MS = 5000
// Discord 메시지 한 개의 글자 상한
const MAX_CHARS = 2000

/**
 * Discord 웹후크로 글 하나를 보낸다(운영 알림, docs/design/incidents.md). 실패해도 던지지 않는다: 알림 때문에 감시가 멈추지 않는다.
 * 주소는 보내기 권한이라 로그에 남기지 않는다. `@everyone` 같은 호출은 막는다(AI가 쓴 글 · 경고 글이 들어간다).
 */
@Injectable()
export class DiscordNotifier {
  private readonly logger = new Logger(DiscordNotifier.name)
  private readonly operatorUrl: string | undefined

  constructor(config: ConfigService<Env, true>) {
    this.operatorUrl = config.get('DISCORD_WEBHOOK_URL', { infer: true })
  }

  toOperator(content: string): Promise<void> {
    return this.operatorUrl ? this.send(this.operatorUrl, 'operator', content) : Promise.resolve()
  }

  toStudent(url: string | null, content: string): Promise<void> {
    return url ? this.send(url, 'student', content) : Promise.resolve()
  }

  private async send(url: string, who: string, content: string): Promise<void> {
    // 저장된 값이 바뀌었어도 discord.com 밖으로는 보내지 않는다.
    if (!DISCORD_WEBHOOK.test(url)) return
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.slice(0, MAX_CHARS), allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      await res.arrayBuffer()
      if (!res.ok) this.logger.warn(`Discord (${who}) answered ${res.status}`)
    } catch (err) {
      this.logger.warn(`Discord (${who}) not sent: ${err instanceof Error ? err.name : 'error'}`)
    }
  }
}
