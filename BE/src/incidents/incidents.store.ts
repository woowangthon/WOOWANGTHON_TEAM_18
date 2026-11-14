import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { isRecord } from '../common/is-record.js'
import type { Env } from '../config/env.js'

const TIMEOUT_MS = 5000

const databaseUnavailable = () => new ServiceUnavailableException({ code: 'DATABASE_UNAVAILABLE', message: 'Could not reach the database' })

export type IncidentAction = 'auto_stopped' | 'pending' | 'stopped' | 'dismissed'

export const RISKS = ['low', 'medium', 'high'] as const
export const RECOMMENDATIONS = ['stop', 'watch', 'ignore'] as const
export const MODELS = ['local', 'planner'] as const

export interface IncidentAi {
  status: 'pending' | 'done' | 'failed' | 'skipped'
  risk: (typeof RISKS)[number] | null
  recommendation: (typeof RECOMMENDATIONS)[number] | null
  cause: string | null
  reason: string | null
  model: (typeof MODELS)[number] | null
}

/** 판단 내용이 없는 AI 칸(기다림 · 실패 · 건너뜀). */
export const emptyAi = (status: Exclude<IncidentAi['status'], 'done'>): IncidentAi => ({ status, risk: null, recommendation: null, cause: null, reason: null, model: null })

export interface IncidentRow {
  id: string
  slug: string
  alertname: string
  labels: Record<string, string>
  summary: string
  fired_at: string
  resolved_at: string | null
  action: IncidentAction
  ai: IncidentAi
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

export type NewIncident = Pick<IncidentRow, 'slug' | 'alertname' | 'labels' | 'summary' | 'fired_at' | 'action' | 'ai'>

const isRow = (v: unknown): v is IncidentRow =>
  isRecord(v) && typeof v.id === 'string' && typeof v.slug === 'string' && typeof v.alertname === 'string' && typeof v.action === 'string' && isRecord(v.ai)

/** 이미 같은 열린 경고가 있다(유니크 인덱스 `incidents_open_uniq`). */
class Conflict extends Error {}

/**
 * `incidents` · `user_webhooks`(supabase/migrations/20261114070000_create_incidents.sql). 서버의 secret key로 PostgREST를 부른다(RLS를 건너뛴다).
 * 누가 부를 수 있는지는 부르는 쪽이 정한다. 닿지 못하거나 알아볼 수 없는 답이면 503 DATABASE_UNAVAILABLE이다.
 */
@Injectable()
export class IncidentsStore {
  private readonly logger = new Logger(IncidentsStore.name)
  private readonly restUrl: string
  private readonly secretKey: string

  constructor(config: ConfigService<Env, true>) {
    this.restUrl = `${config.get('SUPABASE_URL', { infer: true })}/rest/v1`
    this.secretKey = config.get('SUPABASE_SECRET_KEY', { infer: true })
  }

  /** 아직 울리는(해소되지 않은) 알림. */
  async unresolved(): Promise<IncidentRow[]> {
    return this.rows('GET', { select: '*', resolved_at: 'is.null' })
  }

  /** 운영자가 정할 차례인 알림(울리고 있고 pending), 최근 것부터. */
  async waiting(): Promise<IncidentRow[]> {
    return this.rows('GET', { select: '*', resolved_at: 'is.null', action: 'eq.pending', order: 'created_at.desc' })
  }

  /** 새 경고를 적는다. 같은 열린 경고가 이미 있으면(다른 확인이 먼저 적었다) null. */
  async insert(row: NewIncident): Promise<IncidentRow | null> {
    try {
      return (await this.rows('POST', {}, row))[0] ?? null
    } catch (err) {
      if (err instanceof Conflict) return null
      throw err
    }
  }

  async resolve(id: string): Promise<void> {
    const now = new Date().toISOString()
    await this.rows('PATCH', { id: `eq.${id}`, resolved_at: 'is.null' }, { resolved_at: now, updated_at: now })
  }

  /** `action`이 `from`일 때만 바꾼다(겹친 결정은 하나만 통과). 바꿨으면 바뀐 줄, 아니면 null. */
  async update(
    id: string,
    patch: Partial<Pick<IncidentRow, 'action' | 'ai' | 'decided_by' | 'decided_at'>>,
    from?: IncidentAction,
    aiFrom?: IncidentAi['status'],
  ): Promise<IncidentRow | null> {
    const where: Record<string, string> = { id: `eq.${id}`, ...(from ? { action: `eq.${from}` } : {}), ...(aiFrom ? { 'ai->>status': `eq.${aiFrom}` } : {}) }
    return (await this.rows('PATCH', where, { ...patch, updated_at: new Date().toISOString() }))[0] ?? null
  }

  /** 이 프로젝트의 정할 차례인(울리고 있고 pending) 알림을 모두 같은 결정으로 닫는다. 닫은 줄을 돌려준다. */
  async closePending(slug: string, patch: Pick<IncidentRow, 'action' | 'decided_by' | 'decided_at'> & Partial<Pick<IncidentRow, 'ai'>>): Promise<IncidentRow[]> {
    return this.rows('PATCH', { slug: `eq.${slug}`, resolved_at: 'is.null', action: 'eq.pending' }, { ...patch, updated_at: new Date().toISOString() })
  }

  async find(id: string): Promise<IncidentRow | null> {
    return (await this.rows('GET', { select: '*', id: `eq.${id}`, limit: '1' }))[0] ?? null
  }

  async recent(limit: number): Promise<IncidentRow[]> {
    return this.rows('GET', { select: '*', order: 'created_at.desc', limit: String(limit) })
  }

  /** 이 프로젝트들의 열린 경고와 `since` 뒤에 생긴 경고. */
  async forSlugs(slugs: string[], since: string): Promise<IncidentRow[]> {
    if (slugs.length === 0) return []
    return this.rows('GET', { select: '*', slug: `in.(${slugs.join(',')})`, or: `(resolved_at.is.null,created_at.gte.${since})`, order: 'created_at.desc', limit: '50' })
  }

  /** 사용자가 배포를 저장한 프로젝트(slug, 중복 없이). */
  async ownedSlugs(userId: string): Promise<string[]> {
    const rows = await this.call('deploys', 'GET', { select: 'slug', user_id: `eq.${userId}`, limit: '1000' })
    return [...new Set(rows.flatMap((r) => (isRecord(r) && typeof r.slug === 'string' ? [r.slug] : [])))]
  }

  async webhook(userId: string): Promise<string | null> {
    const rows = await this.call('user_webhooks', 'GET', { select: 'url', user_id: `eq.${userId}` })
    const url = isRecord(rows[0]) ? rows[0].url : undefined
    return typeof url === 'string' ? url : null
  }

  async setWebhook(userId: string, url: string | null): Promise<void> {
    if (url === null) await this.call('user_webhooks', 'DELETE', { user_id: `eq.${userId}` })
    else await this.call('user_webhooks', 'POST', { on_conflict: 'user_id' }, { user_id: userId, url, updated_at: new Date().toISOString() }, 'resolution=merge-duplicates,return=representation')
  }

  private async rows(method: 'GET' | 'POST' | 'PATCH', query: Record<string, string>, body?: object): Promise<IncidentRow[]> {
    const rows = await this.call('incidents', method, query, body)
    if (!rows.every(isRow)) {
      this.logger.error(`Supabase ${method} /rest/v1/incidents answered a row it should not have`)
      throw databaseUnavailable()
    }
    return rows
  }

  private async call(table: 'incidents' | 'user_webhooks' | 'deploys', method: 'GET' | 'POST' | 'PATCH' | 'DELETE', query: Record<string, string>, body?: object, prefer = 'return=representation'): Promise<unknown[]> {
    const qs = new URLSearchParams(query).toString()
    try {
      const res = await fetch(`${this.restUrl}/${table}${qs ? `?${qs}` : ''}`, {
        method,
        headers: { apikey: this.secretKey, ...(method !== 'GET' ? { Prefer: prefer } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const text = await res.text()
      if (res.status === 409) throw new Conflict()
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = undefined
      }
      if (!res.ok || !Array.isArray(parsed)) {
        // 본문은 싣지 않는다(웹후크 주소가 들어 있을 수 있다).
        this.logger.error(`Supabase ${method} /rest/v1/${table} answered ${res.status}`)
        throw databaseUnavailable()
      }
      return parsed as unknown[]
    } catch (err) {
      if (err instanceof ServiceUnavailableException || err instanceof Conflict) throw err
      this.logger.error(`Supabase ${method} /rest/v1/${table} failed: ${err instanceof Error ? err.name : 'error'}`)
      throw databaseUnavailable()
    }
  }
}
