import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { isRecord } from '../common/is-record.js'
import type { Env } from '../config/env.js'
import { isImageDigest, type Slot } from './deploy-condition.js'
import type { Spec } from './deploy-input.js'

const TIMEOUT_MS = 5000

const databaseUnavailable = () =>
  new ServiceUnavailableException({ code: 'DATABASE_UNAVAILABLE', message: 'Could not reach the database' })

/** `deploys` 테이블의 한 행(supabase/migrations). */
export interface DeployRow {
  id: string
  user_id: string
  slug: string
  repo: string
  commit_sha: string
  spec: Spec
  created_at: string
}

type NewDeploy = Pick<DeployRow, 'user_id' | 'slug' | 'repo' | 'commit_sha' | 'spec'>

const isRow = (v: unknown): v is DeployRow =>
  isRecord(v) &&
  ['id', 'user_id', 'slug', 'repo', 'commit_sha', 'created_at'].every((k) => typeof v[k] === 'string') &&
  isRecord(v.spec)

type Table = 'deploys' | 'projects' | 'build_cache'

/**
 * `deploys` · `projects` · `build_cache` 테이블 접근. 서버의 secret key로 Supabase PostgREST를 부른다(RLS를 건너뛴다). 그래서 어떤 행을 읽고 쓸지는 이 클래스를 부르는 쪽이
 * 정한다: user_id는 검증한 토큰에서 오고, 질의 값은 URLSearchParams가 인코딩한다. 키는 apikey 헤더로 SUPABASE_URL에만 보내고 로그에 남기지 않는다.
 * 닿지 못하거나 알아볼 수 없는 답이면 503 DATABASE_UNAVAILABLE이다. 설계는 docs/design/auth.md "배포 입력 저장".
 */
@Injectable()
export class DeploysStore {
  private readonly logger = new Logger(DeploysStore.name)
  private readonly restUrl: string
  private readonly secretKey: string

  constructor(config: ConfigService<Env, true>) {
    this.restUrl = `${config.get('SUPABASE_URL', { infer: true })}/rest/v1`
    this.secretKey = config.get('SUPABASE_SECRET_KEY', { infer: true })
  }

  /** 이 slug를 이미 쓰는 행의 주인과 레포. 없으면 undefined. */
  async findSlugOwner(slug: string): Promise<{ user_id: string; repo: string } | undefined> {
    const rows = await this.call('deploys', 'GET', { select: 'user_id,repo', slug: `eq.${slug}`, limit: '1' })
    const row = rows[0]
    if (row === undefined) return undefined
    if (!isRecord(row) || typeof row.user_id !== 'string' || typeof row.repo !== 'string') throw this.unreadable('deploys', 'GET')
    return { user_id: row.user_id, repo: row.repo }
  }

  async insert(row: NewDeploy): Promise<DeployRow> {
    const rows = await this.call('deploys', 'POST', {}, row)
    if (rows.length !== 1 || !isRow(rows[0])) throw this.unreadable('deploys', 'POST')
    return rows[0]
  }

  /** id와 user_id가 모두 맞는 행. 없으면 undefined(남의 행도 없는 것과 같다). */
  async findOwned(id: string, userId: string): Promise<DeployRow | undefined> {
    const rows = await this.call('deploys', 'GET', { select: '*', id: `eq.${id}`, user_id: `eq.${userId}`, limit: '1' })
    if (rows.length === 0) return undefined
    if (!isRow(rows[0])) throw this.unreadable('deploys', 'GET')
    return rows[0]
  }

  /** id로 찾은 행. 사용자 요청이 아니라 워크플로우(W4)가 부른다. 없으면 undefined. */
  async findById(id: string): Promise<DeployRow | undefined> {
    const rows = await this.call('deploys', 'GET', { select: '*', id: `eq.${id}`, limit: '1' })
    if (rows.length === 0) return undefined
    if (!isRow(rows[0])) throw this.unreadable('deploys', 'GET')
    return rows[0]
  }

  /** 프로젝트의 live 슬롯. 프로젝트 행이 없거나 live 슬롯이 아직 없으면(첫 배포 전) null. */
  async liveSlot(slug: string): Promise<Slot | null> {
    const rows = await this.call('projects', 'GET', { select: 'live_slot', slug: `eq.${slug}`, limit: '1' })
    if (rows.length === 0) return null
    const live = isRecord(rows[0]) ? rows[0].live_slot : undefined
    if (live !== null && live !== 'a' && live !== 'b') throw this.unreadable('projects', 'GET')
    return live
  }

  /** 이 서비스 · 빌드 입력 해시로 이미 만든 이미지의 digest 주소. 없으면 null. */
  async cachedImage(slug: string, service: string, buildInputHash: string): Promise<string | null> {
    const rows = await this.call('build_cache', 'GET', {
      select: 'image',
      slug: `eq.${slug}`,
      service: `eq.${service}`,
      build_input_hash: `eq.${buildInputHash}`,
      limit: '1',
    })
    if (rows.length === 0) return null
    const image = isRecord(rows[0]) ? rows[0].image : undefined
    if (!isImageDigest(image)) throw this.unreadable('build_cache', 'GET')
    return image
  }

  private async call(table: Table, method: 'GET' | 'POST', query: Record<string, string>, body?: object): Promise<unknown[]> {
    const qs = new URLSearchParams(query).toString()
    const url = `${this.restUrl}/${table}`
    try {
      const res = await fetch(qs ? `${url}?${qs}` : url, {
        method,
        // 새 secret key는 JWT가 아니라 Authorization 헤더로 보내면 거부된다. apikey 하나로 보낸다.
        headers: {
          apikey: this.secretKey,
          ...(body ? { 'Content-Type': 'application/json', Prefer: 'return=representation' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      // 오류 응답이어도 본문을 끝까지 읽어 연결이 풀로 돌아가게 한다. 본문은 로그에 싣지 않는다(spec이나 키가 들어 있을 수 있다).
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

  private unreadable(table: Table, method: string) {
    this.logger.error(`Supabase ${method} /rest/v1/${table} answered a row it should not have`)
    return databaseUnavailable()
  }
}
