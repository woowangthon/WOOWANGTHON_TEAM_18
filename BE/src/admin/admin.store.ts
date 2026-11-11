import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { isRecord } from '../common/is-record.js'
import type { Env } from '../config/env.js'

const TIMEOUT_MS = 5000
// 한 번에 읽는 행 수 상한. 이를 넘는 오래된 프로젝트 · 기록은 빠진다(MVP 규모는 수십 개라 넘지 않는다. docs/design/api.md).
const MAX_ROWS = 500

const databaseUnavailable = () =>
  new ServiceUnavailableException({ code: 'DATABASE_UNAVAILABLE', message: 'Could not reach the database' })

export interface ProjectRecord {
  slug: string
  repo: string
  ownerId: string
  liveSlot: 'a' | 'b' | null
}

export interface StopRecord {
  at: string
  by: string
}

const str = (v: unknown): v is string => typeof v === 'string'

/**
 * 운영자 API가 읽고 쓰는 테이블(`deploys` · `projects` · `admin_actions`). 서버의 secret key로 PostgREST를 부르므로(RLS를 건너뛴다)
 * 누가 부를 수 있는지는 부르는 쪽(AdminGuard)이 정한다. 닿지 못하거나 알아볼 수 없는 답이면 503 DATABASE_UNAVAILABLE이다.
 */
@Injectable()
export class AdminStore {
  private readonly logger = new Logger(AdminStore.name)
  private readonly restUrl: string
  private readonly secretKey: string

  constructor(config: ConfigService<Env, true>) {
    this.restUrl = `${config.get('SUPABASE_URL', { infer: true })}/rest/v1`
    this.secretKey = config.get('SUPABASE_SECRET_KEY', { infer: true })
  }

  /** 배포가 하나라도 있는 프로젝트. 가장 최근에 저장한 배포 순, 프로젝트마다 한 줄(최근 배포의 소유자와 레포). */
  async projects(): Promise<ProjectRecord[]> {
    const [deploys, projects] = await Promise.all([
      this.call('deploys', 'GET', { select: 'slug,repo,user_id', order: 'created_at.desc', limit: String(MAX_ROWS) }),
      this.call('projects', 'GET', { select: 'slug,live_slot' }),
    ])
    const lives = new Map<string, 'a' | 'b' | null>()
    for (const row of projects) {
      if (!isRecord(row) || !str(row.slug) || (row.live_slot !== null && row.live_slot !== 'a' && row.live_slot !== 'b')) throw this.unreadable('projects')
      lives.set(row.slug, row.live_slot)
    }
    const seen = new Set<string>()
    const out: ProjectRecord[] = []
    for (const row of deploys) {
      if (!isRecord(row) || !str(row.slug) || !str(row.repo) || !str(row.user_id)) throw this.unreadable('deploys')
      if (seen.has(row.slug)) continue
      seen.add(row.slug)
      out.push({ slug: row.slug, repo: row.repo, ownerId: row.user_id, liveSlot: lives.get(row.slug) ?? null })
    }
    return out
  }

  async projectExists(slug: string): Promise<boolean> {
    return (await this.call('deploys', 'GET', { select: 'id', slug: `eq.${slug}`, limit: '1' })).length > 0
  }

  /** 프로젝트마다 가장 최근의 강제 중지 기록. */
  async lastStops(): Promise<Map<string, StopRecord>> {
    const rows = await this.call('admin_actions', 'GET', { select: 'slug,actor_email,created_at', action: 'eq.stop', order: 'created_at.desc', limit: String(MAX_ROWS) })
    const out = new Map<string, StopRecord>()
    for (const row of rows) {
      if (!isRecord(row) || !str(row.slug) || !str(row.actor_email) || !str(row.created_at)) throw this.unreadable('admin_actions')
      if (!out.has(row.slug)) out.set(row.slug, { at: new Date(row.created_at).toISOString(), by: row.actor_email })
    }
    return out
  }

  async recordStop(slug: string, actor: { id: string; email: string }): Promise<void> {
    await this.call('admin_actions', 'POST', {}, { slug, action: 'stop', actor_id: actor.id, actor_email: actor.email })
  }

  private async call(table: string, method: 'GET' | 'POST', query: Record<string, string>, body?: object): Promise<unknown[]> {
    const qs = new URLSearchParams(query).toString()
    try {
      const res = await fetch(`${this.restUrl}/${table}${qs ? `?${qs}` : ''}`, {
        method,
        headers: { apikey: this.secretKey, ...(body ? { 'Content-Type': 'application/json', Prefer: 'return=representation' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const text = await res.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = undefined
      }
      if (!res.ok || !Array.isArray(parsed)) {
        this.logger.error(`Supabase ${method} /rest/v1/${table} answered ${res.status}`)
        throw databaseUnavailable()
      }
      return parsed as unknown[]
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err
      this.logger.error(err)
      throw databaseUnavailable()
    }
  }

  private unreadable(table: string) {
    this.logger.error(`Supabase GET /rest/v1/${table} answered a row it should not have`)
    return databaseUnavailable()
  }
}
