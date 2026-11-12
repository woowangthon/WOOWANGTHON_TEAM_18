import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { isRecord } from '../common/is-record.js'
import type { Env } from '../config/env.js'

const TIMEOUT_MS = 10_000
const HISTORY_PAGE = 20

const unavailable = () => new ServiceUnavailableException({ code: 'PIPELINE_UNAVAILABLE', message: 'Could not start the deploy pipeline' })

/** 시험 실행이 돌릴 스테이지(api.md "파이프라인 ↔ 플랫폼 서버" 4번 `TRIAL_STAGES`). */
export type TrialStages = 'build' | 'render' | 'prepare,render,apply' | 'verify'

/**
 * GoCD 서버 호출. 배포 파이프라인(`GOCD_PIPELINE`)과 AI 에이전트의 시험 전용 파이프라인(`GOCD_TRIAL_PIPELINE`)을 실행하고, 시험 파이프라인의 남은 스테이지를 취소한다.
 * 배포 입력은 싣지 않고 id만 넘긴다: 파이프라인이 `GET /api/pipeline/...`으로 읽어 간다. 토큰은 GOCD_URL에만 보내고 로그에 남기지 않는다.
 * 실행할 수 없으면(설정 없음 · 닿지 못함 · 거절) 503 PIPELINE_UNAVAILABLE이다.
 */
@Injectable()
export class PipelineClient {
  private readonly logger = new Logger(PipelineClient.name)
  private readonly url: string | undefined
  private readonly token: string | undefined
  private readonly pipeline: string | undefined
  private readonly trialPipeline: string | undefined

  constructor(config: ConfigService<Env, true>) {
    this.url = config.get('GOCD_URL', { infer: true })
    this.token = config.get('GOCD_TOKEN', { infer: true })
    this.pipeline = config.get('GOCD_PIPELINE', { infer: true })
    this.trialPipeline = config.get('GOCD_TRIAL_PIPELINE', { infer: true })
  }

  /** 배포 파이프라인을 한 번 실행한다. */
  async run(deployId: string): Promise<void> {
    await this.schedule(this.pipeline, 'GOCD_PIPELINE', [{ name: 'DEPLOY_ID', value: deployId }])
  }

  /** 시험 전용 파이프라인을 한 번 실행한다. 비밀값은 넣지 않는다. */
  async runTrial(deployId: string, trialId: string, stages: TrialStages): Promise<void> {
    await this.schedule(this.trialPipeline, 'GOCD_TRIAL_PIPELINE', [
      { name: 'DEPLOY_ID', value: deployId },
      { name: 'TRIAL_ID', value: trialId },
      { name: 'TRIAL_STAGES', value: stages },
    ])
  }

  /**
   * 시험 파이프라인 인스턴스 하나의 진행 중인 스테이지를 취소한다(GoCD의 취소 단위는 스테이지이고, 취소된 스테이지 뒤는 돌지 않는다).
   * 그 인스턴스에 진행 중인 스테이지가 없거나 모두 취소했으면 true, 확인하지 못했으면 false.
   */
  async cancelTrial(counter: number): Promise<boolean> {
    const pipeline = this.trialPipeline
    if (!this.configured(pipeline)) return false
    try {
      const instance = await this.get(`/go/api/pipelines/${encodeURIComponent(pipeline)}/${counter}`)
      return await this.cancelRunning(pipeline, instance)
    } catch (err) {
      this.logger.error(err)
      return false
    }
  }

  /**
   * 시험 파이프라인의 끝나지 않은 인스턴스를 모두 취소한다(BE가 시작할 때: 시험 기록이 메모리에 있어 이어 갈 수 없다). 취소한 인스턴스 수.
   * 하나라도 취소를 확인하지 못하면 던진다(정리 실패: 그 인스턴스가 아직 대상 슬롯을 바꾸고 있을 수 있다).
   */
  async cancelAllTrials(): Promise<number> {
    const pipeline = this.trialPipeline
    if (!this.configured(pipeline)) return 0
    const history = await this.get(`/go/api/pipelines/${encodeURIComponent(pipeline)}/history?page_size=${HISTORY_PAGE}`)
    const instances: unknown[] = isRecord(history) && Array.isArray(history.pipelines) ? history.pipelines : []
    let cancelled = 0
    let failed = 0
    for (const instance of instances) {
      if (runningStages(instance).length === 0) continue
      if (await this.cancelRunning(pipeline, instance)) cancelled++
      else failed++
    }
    if (failed > 0) throw new Error(`could not cancel ${failed} unfinished trial run(s)`)
    return cancelled
  }

  private configured(pipeline: string | undefined): pipeline is string {
    return Boolean(this.url && this.token && pipeline)
  }

  private async schedule(pipeline: string | undefined, name: string, env: { name: string; value: string }[]): Promise<void> {
    if (!this.configured(pipeline)) {
      this.logger.error(`GOCD_URL, GOCD_TOKEN and ${name} must all be set to start a pipeline`)
      throw unavailable()
    }
    try {
      const res = await this.send('POST', `/go/api/pipelines/${encodeURIComponent(pipeline)}/schedule`, 'application/vnd.go.cd.v1+json', {
        environment_variables: env,
        update_materials_before_scheduling: true,
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

  private async cancelRunning(pipeline: string, instance: unknown): Promise<boolean> {
    const counter = isRecord(instance) ? count(instance.counter) : null
    if (counter === null) return false
    for (const stage of runningStages(instance)) {
      const path = `/go/api/stages/${encodeURIComponent(pipeline)}/${counter}/${encodeURIComponent(stage.name)}/${stage.counter}/cancel`
      const res = await this.send('POST', path, 'application/vnd.go.cd.v3+json')
      await res.arrayBuffer()
      if (!res.ok) {
        this.logger.error(`GoCD stage cancel answered ${res.status}`)
        return false
      }
    }
    return true
  }

  private async get(path: string): Promise<unknown> {
    const res = await this.send('GET', path, 'application/vnd.go.cd.v1+json')
    const text = await res.text()
    if (!res.ok) throw new Error(`GoCD GET answered ${res.status}`)
    return JSON.parse(text) as unknown
  }

  private send(method: 'GET' | 'POST', path: string, accept: string, body?: object): Promise<Response> {
    return fetch(`${this.url}${path}`, {
      method,
      headers: {
        Accept: accept,
        Authorization: `Bearer ${this.token}`,
        ...(method === 'POST' ? { 'X-GoCD-Confirm': 'true' } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  }
}

// GoCD 문서의 예는 counter를 숫자로 주지만 버전에 따라 문자열일 수 있어 둘 다 받는다(실제 서버로 확인하지 않았다).
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null)

/** 인스턴스에서 아직 도는(또는 실행기 배정을 기다리는) 스테이지. GoCD는 둘 다 `Building`으로 알린다. */
function runningStages(instance: unknown): { name: string; counter: number }[] {
  const stages: unknown[] = isRecord(instance) && Array.isArray(instance.stages) ? instance.stages : []
  return stages.flatMap((s) => {
    const counter = isRecord(s) ? count(s.counter) : null
    return isRecord(s) && s.status === 'Building' && typeof s.name === 'string' && counter !== null ? [{ name: s.name, counter }] : []
  })
}
