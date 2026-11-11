import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { Request } from 'express'
import type { Env } from '../config/env.js'

const digest = (s: string) => createHash('sha256').update(s).digest()

/** 파이프라인용 기계 토큰(PIPELINE_NOTIFY_TOKEN). 설정이 없으면 모든 요청을 거절한다. 길이가 새지 않게 해시끼리 비교한다. */
@Injectable()
export class PipelineTokenGuard implements CanActivate {
  private readonly expected: Buffer | undefined

  constructor(config: ConfigService<Env, true>) {
    const token = config.get('PIPELINE_NOTIFY_TOKEN', { infer: true })
    this.expected = token ? digest(token) : undefined
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>()
    const given = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '')?.[1]
    if (!this.expected || !given || !timingSafeEqual(this.expected, digest(given))) {
      throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Pipeline token required' })
    }
    return true
  }
}
