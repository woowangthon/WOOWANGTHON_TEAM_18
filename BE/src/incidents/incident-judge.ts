import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { redactString } from '../common/redact.js'
import type { Env } from '../config/env.js'
import { ClusterReader, type PodInfo } from '../k8s/cluster-reader.js'
import { emptyAi, type IncidentAi, type IncidentRow, MODELS, RECOMMENDATIONS, RISKS } from './incidents.store.js'

// AI 서버는 로컬 모델(40초) → 추론 API(40초)까지 본다.
const TIMEOUT_MS = 90_000
const LOG_TIMEOUT_MS = 3000
const LOG_LINES = 200
const MAX_PODS = 20
const TEXT_CHARS = 300

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)

const FAILED = emptyAi('failed')

/**
 * AI 서버 `POST /agent/incidents`에 경고 하나의 판단을 묻는다(docs/design/incidents.md). 던지지 않는다: 못 받으면 status failed.
 * 보내는 것: 경고 이름 · 고른 라벨 · summary, 프로젝트 Pod 목록, 경고의 Pod(없으면 가장 많이 재시작한 Pod) 로그 200줄. 모두 비밀값 필터를 거친다.
 */
@Injectable()
export class IncidentJudge {
  private readonly logger = new Logger(IncidentJudge.name)
  private readonly url: string | undefined
  private readonly token: string | undefined

  constructor(
    config: ConfigService<Env, true>,
    private readonly reader: ClusterReader,
  ) {
    this.url = config.get('AI_SERVER_URL', { infer: true })
    this.token = config.get('AGENT_API_TOKEN', { infer: true })
  }

  async judge(incident: IncidentRow): Promise<IncidentAi> {
    if (!this.url || !this.token) return FAILED
    const pods = await this.reader.pods(incident.slug).catch(() => [] as PodInfo[])
    const body = {
      incidentId: incident.id,
      slug: incident.slug,
      alertname: incident.alertname,
      summary: incident.summary,
      labels: incident.labels,
      pods: pods.slice(0, MAX_PODS).map(({ name, phase, ready, restarts, waiting }) => ({ name, phase, ready, restarts, waiting })),
      logs: await this.logs(incident, pods),
    }
    try {
      const res = await fetch(`${this.url}/agent/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const answer: unknown = await res.json().catch(() => null)
      if (res.status !== 200) {
        this.logger.warn(`AI server answered ${res.status} to POST /agent/incidents`)
        return FAILED
      }
      return parse(answer) ?? FAILED
    } catch (err) {
      this.logger.warn(`AI server not reached for an incident: ${err instanceof Error ? err.name : 'error'}`)
      return FAILED
    }
  }

  /** 상한(3초)을 넘거나 읽지 못하면 빈 로그다. 로그 때문에 판단이 늦거나 빠지지 않는다. */
  private async logs(incident: IncidentRow, pods: PodInfo[]): Promise<string[]> {
    const pod = pods.find((p) => p.name === incident.labels.pod) ?? [...pods].sort((a, b) => b.restarts - a.restarts)[0]
    if (!pod) return []
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<string[]>((resolve) => {
      timer = setTimeout(() => resolve([]), LOG_TIMEOUT_MS)
    })
    const read = this.reader
      .logs(incident.slug, pod.name, { tailLines: LOG_LINES, previous: pod.restarts > 0 })
      .then((text) => text.split('\n').filter((l) => l !== '').slice(-LOG_LINES).map(redactString))
      .catch(() => [])
    const got = await Promise.race([read, timeout])
    clearTimeout(timer)
    return got
  }
}

function parse(v: unknown): IncidentAi | null {
  if (typeof v !== 'object' || v === null) return null
  const { risk, recommendation, cause, reason, model } = v as Record<string, unknown>
  if (!oneOf(RISKS, risk) || !oneOf(RECOMMENDATIONS, recommendation) || !oneOf(MODELS, model) || typeof cause !== 'string' || typeof reason !== 'string') return null
  return { status: 'done', risk, recommendation, cause: cause.slice(0, TEXT_CHARS), reason: reason.slice(0, TEXT_CHARS), model }
}
