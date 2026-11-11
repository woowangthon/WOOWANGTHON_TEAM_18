import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Env } from '../config/env.js'

const TIMEOUT_MS = 10_000

const unavailable = () => new ServiceUnavailableException({ code: 'PIPELINE_UNAVAILABLE', message: 'Could not start the deploy pipeline' })

/**
 * GoCD 파이프라인을 한 번 실행한다(`POST /go/api/pipelines/<이름>/schedule`). 배포 입력은 싣지 않고 `DEPLOY_ID`만 넘긴다:
 * 파이프라인이 `GET /api/pipeline/deploys/:id/input`으로 읽어 간다. 토큰은 GOCD_URL에만 보내고 로그에 남기지 않는다.
 * 설정이 없거나 닿지 못하거나 거절당하면 503 PIPELINE_UNAVAILABLE이다.
 */
@Injectable()
export class PipelineClient {
  private readonly logger = new Logger(PipelineClient.name)
  private readonly url: string | undefined
  private readonly token: string | undefined
  private readonly pipeline: string | undefined

  constructor(config: ConfigService<Env, true>) {
    this.url = config.get('GOCD_URL', { infer: true })
    this.token = config.get('GOCD_TOKEN', { infer: true })
    this.pipeline = config.get('GOCD_PIPELINE', { infer: true })
  }

  async run(deployId: string): Promise<void> {
    if (!this.url || !this.token || !this.pipeline) {
      this.logger.error('GOCD_URL, GOCD_TOKEN and GOCD_PIPELINE must all be set to start a pipeline')
      throw unavailable()
    }
    try {
      const res = await fetch(`${this.url}/go/api/pipelines/${encodeURIComponent(this.pipeline)}/schedule`, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.go.cd.v1+json',
          'Content-Type': 'application/json',
          'X-GoCD-Confirm': 'true',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          environment_variables: [{ name: 'DEPLOY_ID', value: deployId }],
          update_materials_before_scheduling: true,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      await res.arrayBuffer() // 연결을 풀로 돌려보낸다. 본문은 쓰지 않고 로그에도 싣지 않는다.
      if (!res.ok) {
        this.logger.error(`GoCD schedule answered ${res.status}`)
        throw unavailable()
      }
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err
      this.logger.error(err)
      throw unavailable()
    }
  }
}
