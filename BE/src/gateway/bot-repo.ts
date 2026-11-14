import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { isRecord } from '../common/is-record.js'
import type { Env } from '../config/env.js'

// 봇 계정(wanggane-bot, ADR-002)으로 GitHub를 부른다: 학생 레포를 fork하고, fork에 수정 commit을 만들고, 학생 레포에 PR을 연다.
// 토큰(BOT_GITHUB_TOKEN)은 api.github.com으로만 보내고 로그 · 응답 · 오류 메시지에 싣지 않는다. GitHub의 응답 본문도 에이전트에게 넘기지 않는다.

const API = 'https://api.github.com'
const PATCH_FORMAT = 'application/vnd.github.patch'
const TIMEOUT_MS = 20_000
const REPO_NAME = /^(?!\.{1,2}\/)[A-Za-z0-9_.-]+\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/
/** fork는 GitHub가 비동기로 만든다. 이 시간 안에 안 보이면 못 만든 것으로 본다. */
const FORK_WAIT_TRIES = 15
/** compare patch의 최대 글자 수(파일 5개 · 50줄 수정이면 넉넉하다). */
const PATCH_LIMIT = 100_000

/** `none`: 토큰이 없음. `cannot-fork`: 이 레포를 fork할 수 없음(막혔거나 비공개). `github`: GitHub가 안 닿거나 거절. */
export class BotError extends Error {
  constructor(readonly kind: 'none' | 'cannot-fork' | 'github') {
    super(kind)
  }
}

export interface BaseEntry {
  /** git 파일 모드: 일반 파일 `100644` · 실행 파일 `100755`. 그 밖(심볼릭 링크 · 서브모듈)은 고칠 수 없다. */
  mode: string
  type: string
  sha: string
  size: number
}

export type PullOutcome = { opened: true; url: string } | { opened: false }

interface Reply {
  status: number
  body: unknown
}

@Injectable()
export class BotRepo {
  private readonly logger = new Logger(BotRepo.name)
  private readonly token: string | undefined
  private botLogin: string | undefined
  private readonly forks = new Map<string, string>()
  /** fork가 보일 때까지 기다리는 간격(ms). 시험에서 줄인다. */
  waitMs = 2000

  constructor(config: ConfigService<Env, true>) {
    this.token = config.get('BOT_GITHUB_TOKEN', { infer: true })
  }

  /** 토큰이 설정돼 있는가. */
  available(): boolean {
    return this.token !== undefined
  }

  /** `owner/name`의 봇 fork(`bot/name`)를 돌려준다. 없으면 만든다(있으면 GitHub가 그 fork를 돌려준다). */
  async fork(repo: string): Promise<string> {
    const known = this.forks.get(repo)
    if (known) return known
    if (!REPO_NAME.test(repo)) throw new BotError('cannot-fork')
    const login = await this.login()
    const res = await this.request('POST', `/repos/${repo}/forks`, { default_branch_only: true })
    // 막힌 레포(비공개 · fork 금지)는 403 · 404 · 422로 답한다. 인증 · 한도 · 서버 오류는 막힌 것이 아니다.
    if ([403, 404, 422].includes(res.status)) throw new BotError('cannot-fork')
    if (res.status !== 202 && res.status !== 200) throw this.failed('fork', res.status)
    const data = isRecord(res.body) ? res.body : {}
    const full = typeof data.full_name === 'string' ? data.full_name : ''
    const owner = isRecord(data.owner) ? data.owner.login : undefined
    const parent = isRecord(data.parent) && typeof data.parent.full_name === 'string' ? data.parent.full_name : ''
    // 봇 계정 밑의, 그 레포의 fork여야 한다(같은 이름의 다른 레포를 잘못 쓰지 않는다).
    if (!REPO_NAME.test(full) || owner !== login || data.fork !== true || parent.toLowerCase() !== repo.toLowerCase()) throw new BotError('cannot-fork')
    for (let i = 0; i < FORK_WAIT_TRIES; i++) {
      const seen = await this.request('GET', `/repos/${full}`)
      if (seen.status === 200) {
        this.forks.set(repo, full)
        return full
      }
      if (seen.status !== 404) throw this.failed('fork check', seen.status)
      await new Promise((resolve) => setTimeout(resolve, this.waitMs))
    }
    throw new BotError('cannot-fork')
  }

  /** commit의 파일 목록(경로 → 모드 · blob). 너무 커서 잘렸으면 `truncated`. */
  async tree(fork: string, commitSha: string): Promise<{ treeSha: string; entries: Map<string, BaseEntry>; truncated: boolean }> {
    const commit = this.ok('read commit', await this.request('GET', `/repos/${fork}/git/commits/${commitSha}`))
    const treeSha = isRecord(commit.tree) && typeof commit.tree.sha === 'string' ? commit.tree.sha : ''
    if (!treeSha) throw this.failed('read commit', 200)
    const tree = this.ok('read tree', await this.request('GET', `/repos/${fork}/git/trees/${treeSha}?recursive=1`))
    const entries = new Map<string, BaseEntry>()
    for (const e of Array.isArray(tree.tree) ? tree.tree : []) {
      if (isRecord(e) && typeof e.path === 'string' && typeof e.mode === 'string' && typeof e.type === 'string' && typeof e.sha === 'string') {
        entries.set(e.path, { mode: e.mode, type: e.type, sha: e.sha, size: typeof e.size === 'number' ? e.size : 0 })
      }
    }
    return { treeSha, entries, truncated: tree.truncated === true }
  }

  /** blob의 바이트. */
  async blob(fork: string, sha: string): Promise<Buffer> {
    const data = this.ok('read blob', await this.request('GET', `/repos/${fork}/git/blobs/${sha}`))
    if (typeof data.content !== 'string' || data.encoding !== 'base64') throw this.failed('read blob', 200)
    return Buffer.from(data.content, 'base64')
  }

  /**
   * `baseTree` 위에 파일을 올린 commit을 만들고(부모는 `parent`) `branch`가 그 commit을 가리키게 한다. 새 commit의 SHA를 돌려준다.
   * 같은 branch를 다시 쓰면 force로 옮긴다: 이 티켓의 수정은 이 branch 하나에 모인다.
   */
  async commit(fork: string, parent: string, baseTree: string, branch: string, files: { path: string; mode: string; content: string }[], message: string): Promise<string> {
    const tree = await Promise.all(
      files.map(async (f) => {
        const blob = this.ok('write blob', await this.request('POST', `/repos/${fork}/git/blobs`, { content: f.content, encoding: 'utf-8' }))
        if (typeof blob.sha !== 'string') throw this.failed('write blob', 201)
        return { path: f.path, mode: f.mode, type: 'blob' as const, sha: blob.sha }
      }),
    )
    const made = this.ok('write tree', await this.request('POST', `/repos/${fork}/git/trees`, { base_tree: baseTree, tree }))
    if (typeof made.sha !== 'string') throw this.failed('write tree', 201)
    const commit = this.ok('write commit', await this.request('POST', `/repos/${fork}/git/commits`, { message, tree: made.sha, parents: [parent] }))
    if (typeof commit.sha !== 'string') throw this.failed('write commit', 201)
    await this.moveBranch(fork, branch, commit.sha)
    return commit.sha
  }

  /** `branch`가 `sha`를 가리키게 한다(없으면 만든다). */
  async moveBranch(fork: string, branch: string, sha: string): Promise<void> {
    const created = await this.request('POST', `/repos/${fork}/git/refs`, { ref: `refs/heads/${branch}`, sha })
    if (created.status === 201) return
    // 이미 있으면(같은 티켓의 앞선 수정) 옮긴다.
    if (created.status !== 422) throw this.failed('create branch', created.status)
    this.ok('move branch', await this.request('PATCH', `/repos/${fork}/git/refs/heads/${branch}`, { sha, force: true }))
  }

  /**
   * 학생 레포(`upstream`)의 기본 branch로 가는 PR을 연다(head는 봇 fork의 `branch`). 막히면(PR을 못 열게 함 · 거절) `{ opened: false }`다.
   * 같은 head의 PR이 이미 있으면 그 주소를 돌려준다.
   */
  async pull(upstream: string, branch: string, title: string, body: string): Promise<PullOutcome> {
    const [login, repo] = await Promise.all([this.login(), this.request('GET', `/repos/${upstream}`)])
    if (repo.status !== 200) {
      if ([403, 404].includes(repo.status)) return { opened: false }
      throw this.failed('read repository', repo.status)
    }
    const base = isRecord(repo.body) && typeof repo.body.default_branch === 'string' ? repo.body.default_branch : ''
    if (!base) return { opened: false }
    const res = await this.request('POST', `/repos/${upstream}/pulls`, { title, body, head: `${login}:${branch}`, base, maintainer_can_modify: false })
    if (res.status === 201 && isRecord(res.body) && typeof res.body.html_url === 'string') return { opened: true, url: res.body.html_url }
    if (res.status === 422) {
      const existing = await this.request('GET', `/repos/${upstream}/pulls?head=${encodeURIComponent(`${login}:${branch}`)}&state=all`)
      const list: unknown[] = existing.status === 200 && Array.isArray(existing.body) ? existing.body : []
      const first = list[0]
      if (isRecord(first) && typeof first.html_url === 'string') return { opened: true, url: first.html_url }
    }
    if ([403, 404, 422].includes(res.status)) return { opened: false }
    throw this.failed('open pull request', res.status)
  }

  /** `base`와 `head` 사이의 patch 글(PR을 열 수 없을 때 학생에게 보여 준다). */
  async patch(fork: string, base: string, head: string): Promise<string> {
    const res = await this.request('GET', `/repos/${fork}/compare/${base}...${head}`, undefined, PATCH_FORMAT)
    if (res.status !== 200 || typeof res.body !== 'string') throw this.failed('read patch', res.status)
    return res.body.slice(0, PATCH_LIMIT)
  }

  private async login(): Promise<string> {
    if (this.botLogin) return this.botLogin
    const me = this.ok('read account', await this.request('GET', '/user'))
    if (typeof me.login !== 'string') throw this.failed('read account', 200)
    this.botLogin = me.login
    return me.login
  }

  /** 상태가 2xx인 JSON 객체 응답만 받는다. */
  private ok(what: string, res: Reply): Record<string, unknown> {
    if (res.status < 200 || res.status > 299 || !isRecord(res.body)) throw this.failed(what, res.status)
    return res.body
  }

  private failed(what: string, status: number): BotError {
    // 상태 코드만 남긴다(응답 본문 · 요청 헤더는 남기지 않는다).
    this.logger.error(`GitHub ${what} failed with status ${status}`)
    return new BotError('github')
  }

  private async request(method: string, path: string, body?: unknown, accept = 'application/vnd.github+json'): Promise<Reply> {
    if (!this.token) throw new BotError('none')
    let res: Response
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'woowangthon-platform',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      this.logger.error(`GitHub ${method} request failed: ${err instanceof Error ? err.name : 'error'}`)
      throw new BotError('github')
    }
    if (accept === PATCH_FORMAT) return { status: res.status, body: res.ok ? await res.text() : undefined }
    let parsed: unknown
    try {
      parsed = await res.json()
    } catch {
      parsed = undefined
    }
    return { status: res.status, body: parsed }
  }
}
