import { Injectable } from '@nestjs/common'
import { isRecord } from '../common/is-record.js'
import { hasSecretValue, redactString } from '../common/redact.js'
import { type BaseEntry, BotError, BotRepo } from './bot-repo.js'
import { lineDiff } from './line-diff.js'
import { MAX_FILE_BYTES, repoPath } from './repo-reader.js'
import type { GatewayTicket } from './tickets.js'

// 레포 수정(F13, FR-077, ADR-002 · ADR-012): 에이전트의 edit_repo_file · open_pr. 학생 레포에는 쓰지 않고 봇 계정의 fork에 commit을 만들고,
// 그 commit(`source`)을 시험에 넘겨 확인한 뒤에만 학생 레포로 PR을 연다. 봇 토큰은 BE에만 있고 AI 서버에는 가지 않는다.
// simple: 티켓마다의 수정 기록은 BE 메모리에 둔다(trials · budget과 같다). 서버가 다시 뜨면 이어 쓰지 못하고 새 수정부터 시작한다.

export const MAX_FILES = 5
export const MAX_CHANGED_LINES = 50
const MAX_MESSAGE = 500
const MAX_TITLE = 200
const MAX_BODY = 10_000
/** 티켓은 최대 60분이다. 그보다 오래된 수정 기록은 끝나지 못한 티켓의 것이므로 지운다. */
const KEEP_MS = 2 * 60 * 60_000
const SHA = /^[0-9a-f]{40}$/

export type EditCode = 'INVALID_ARGUMENT' | 'EDIT_FORBIDDEN' | 'NOT_VERIFIED' | 'BOT_UNAVAILABLE'
export type EditAnswer = { ok: true; content: Record<string, unknown> } | Refusal
interface Refusal {
  ok: false
  code: EditCode
  message: string
}

const refuse = (code: EditCode, message: string): Refusal => ({ ok: false, code, message })

interface Changed {
  /** 그 commit(티켓의 commitSha)의 내용. 새 파일이면 ''. */
  before: string
  after: string
  mode: string
}

interface TicketEdits {
  startedAt: number
  fork: string
  /** edit_repo_file의 commit이 쌓이는 branch. PR branch와 따로라, 확인하지 않은 commit이 열린 PR에 들어가지 않는다(서버가 다시 떠 기록을 잃어도). */
  editBranch: string
  /** PR의 head. open_pr만 확인한 commit으로 옮긴다. */
  prBranch: string
  baseTree: string
  /** 티켓의 commitSha 시점 파일 목록(경로 → 모드 · blob). */
  base: Map<string, BaseEntry>
  /** 파일 목록이 GitHub의 상한에 잘렸다. 목록에 없는 경로가 새 파일인지 알 수 없다. */
  truncated: boolean
  /** 이 티켓에서 고친 파일(경로 → 내용). 다시 부르면 이어 쌓는다. */
  files: Map<string, Changed>
  /** edit_repo_file이 돌려준 commit(과 그 commit까지 고친 파일 · 바뀐 줄). `source`는 이 안의 것만 받는다. */
  sources: Map<string, { files: string[]; changedLines: number }>
  /** open_pr의 답. 티켓당 PR은 하나라 다시 부르면 이 답을 돌려준다. PR을 못 열었으면 학생에게 줄 patch. */
  pr: { source: string; content: Record<string, unknown>; url: string | null; patch: string | null } | null
}

/** `source`가 가리키는 곳: 봇 fork의 commit. 시험 입력의 `project.repo` · `commitSha`가 된다. */
export interface SourceRef {
  repo: string
  commitSha: string
}

@Injectable()
export class RepoEdits {
  private readonly tickets = new Map<string, TicketEdits>()
  /** 같은 티켓의 edit_repo_file · open_pr이 겹치지 않게 한다. */
  private readonly busy = new Set<string>()

  constructor(private readonly bot: BotRepo) {}

  /** 티켓이 끝났다. */
  forget(ticketId: string): void {
    this.tickets.delete(ticketId)
    this.busy.delete(ticketId)
  }

  /** 이 티켓이 연 PR(주소가 있는 것만). `pr_opened` 결과가 이 값과 맞는지 보는 데 쓴다. */
  openedPr(ticketId: string): { url: string; files: string[]; changedLines: number } | null {
    const pr = this.tickets.get(ticketId)?.pr
    if (!pr?.url) return null
    return { url: pr.url, ...this.tickets.get(ticketId)!.sources.get(pr.source)! }
  }

  /** PR을 열지 못했을 때 학생에게 줄 patch. 모델이 옮겨 쓰지 않고 플랫폼이 결과에 붙인다(길이 · 잘림 걱정 없이). */
  patchFor(ticketId: string): string | null {
    return this.tickets.get(ticketId)?.pr?.patch ?? null
  }

  /**
   * 시험 · read_repo의 `source` 인자를 봇 fork의 commit으로 바꾼다. 이 티켓에서 edit_repo_file이 돌려준 commit만 받는다.
   * 안 되면 이유(문자열)를 돌려준다.
   */
  resolve(ticket: GatewayTicket, source: unknown): SourceRef | string {
    const keys = isRecord(source) ? Object.keys(source) : []
    if (!isRecord(source) || keys.length !== 1 || typeof source.commitSha !== 'string' || !SHA.test(source.commitSha)) {
      return 'source must be { "commitSha": "<40-char SHA>" } as returned by edit_repo_file'
    }
    const mine = this.tickets.get(ticket.ticketId)
    if (!mine?.sources.has(source.commitSha)) return 'source is not a commit that edit_repo_file returned for this ticket'
    return { repo: mine.fork, commitSha: source.commitSha }
  }

  async edit(ticket: GatewayTicket, args: { files?: unknown; message?: unknown }): Promise<EditAnswer> {
    if (!this.bot.available()) return unavailable()
    const checked = checkEditArgs(args)
    if ('code' in checked) return checked
    return this.exclusive(ticket.ticketId, () => this.doEdit(ticket, checked.files, checked.message))
  }

  /** 같은 티켓에서 한 번에 하나만 돈다. 봇 쪽 오류는 거절로 바꾼다. */
  private async exclusive(ticketId: string, run: () => Promise<EditAnswer>): Promise<EditAnswer> {
    if (this.busy.has(ticketId)) return refuse('INVALID_ARGUMENT', 'another edit_repo_file or open_pr of this ticket is still running')
    this.busy.add(ticketId)
    try {
      return await run()
    } catch (err) {
      return fromBot(err)
    } finally {
      this.busy.delete(ticketId)
    }
  }

  async openPr(ticket: GatewayTicket, args: { source?: unknown; title?: unknown; body?: unknown }, verified: (source: SourceRef) => boolean): Promise<EditAnswer> {
    if (!this.bot.available()) return unavailable()
    if (typeof args.title !== 'string' || args.title.trim() === '' || args.title.length > MAX_TITLE) return refuse('INVALID_ARGUMENT', `title must be a string of 1 to ${MAX_TITLE} characters`)
    if (typeof args.body !== 'string' || args.body.trim() === '' || args.body.length > MAX_BODY) return refuse('INVALID_ARGUMENT', `body must be a string of 1 to ${MAX_BODY} characters`)
    // PR 글은 학생의 공개 레포에 남는다. 비밀처럼 보이는 값이 있으면 열지 않는다.
    if (hasSecretValue(args.title) || hasSecretValue(args.body)) return refuse('EDIT_FORBIDDEN', 'the title or body contains a secret-looking value')
    const source = this.resolve(ticket, args.source)
    if (typeof source === 'string') return refuse('INVALID_ARGUMENT', source)
    const mine = this.tickets.get(ticket.ticketId)!
    // 티켓당 PR은 하나다. 같은 source로 다시 부르면 처음 답을 돌려준다.
    if (mine.pr) {
      return mine.pr.source === source.commitSha ? { ok: true, content: mine.pr.content } : refuse('INVALID_ARGUMENT', 'this ticket already opened a pull request')
    }
    // 같은 source로 run_verify를 통과한 적이 있어야 한다(run_deploy가 그 source로 올린 것을 run_verify가 확인한다).
    if (!verified(source)) return refuse('NOT_VERIFIED', 'run_deploy and then run_verify must pass with this source before open_pr')
    const { title, body } = args
    return this.exclusive(ticket.ticketId, async () => {
      // PR branch가 확인한 commit을 가리키게 한다.
      await this.bot.moveBranch(mine.fork, mine.prBranch, source.commitSha)
      // 그 사이 티켓이 끝났으면(forget이 busy를 지운다) PR을 열지 않는다.
      if (!this.busy.has(ticket.ticketId)) return refuse('INVALID_ARGUMENT', 'the ticket ended before the pull request was opened')
      const pull = await this.bot.pull(ticket.repo, mine.prBranch, title.trim(), body)
      // PR을 못 열면(학생 레포가 막음) patch를 기억해 두고 needs_user 결과에 플랫폼이 붙인다. 에이전트에게는 patch 글을 주지 않는다.
      const patch = pull.opened ? null : redactString(await this.bot.patch(mine.fork, ticket.commitSha, source.commitSha))
      const content = pull.opened ? { url: pull.url } : { url: null, patchAttached: true }
      mine.pr = { source: source.commitSha, content, url: pull.opened ? pull.url : null, patch }
      return { ok: true, content }
    })
  }

  private async doEdit(ticket: GatewayTicket, files: { path: string; content: string }[], message: string): Promise<EditAnswer> {
    this.prune()
    let mine = this.tickets.get(ticket.ticketId)
    if (!mine) {
      const fork = await this.bot.fork(ticket.repo)
      const tree = await this.bot.tree(fork, ticket.commitSha)
      mine = { startedAt: Date.now(), fork, editBranch: `wcp-edit-${ticket.ticketId}`, prBranch: `wcp-fix-${ticket.ticketId}`, baseTree: tree.treeSha, base: tree.entries, truncated: tree.truncated, files: new Map(), sources: new Map(), pr: null }
    }
    if (mine.pr) return refuse('INVALID_ARGUMENT', 'this ticket already opened a pull request')
    const merged = new Map(mine.files)
    for (const f of files) {
      const prior = merged.get(f.path)
      if (prior) {
        merged.set(f.path, { ...prior, after: f.content })
        continue
      }
      const entry = mine.base.get(f.path)
      if (entry === undefined) {
        if (mine.truncated) return refuse('EDIT_FORBIDDEN', `${f.path}: the repository is too large to tell whether this file exists`)
        merged.set(f.path, { before: '', after: f.content, mode: '100644' })
        continue
      }
      if (entry.type !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755')) return refuse('EDIT_FORBIDDEN', `${f.path} is not a regular file`)
      if (entry.size > MAX_FILE_BYTES) return refuse('EDIT_FORBIDDEN', `${f.path} is larger than ${MAX_FILE_BYTES / 1024}KB`)
      let before: string
      try {
        before = new TextDecoder('utf-8', { fatal: true }).decode(await this.bot.blob(mine.fork, entry.sha))
      } catch (err) {
        if (err instanceof BotError) throw err
        return refuse('EDIT_FORBIDDEN', `${f.path} is not a text file`)
      }
      merged.set(f.path, { before, after: f.content, mode: entry.mode })
    }
    // 처음 내용으로 되돌린 파일은 바뀐 파일이 아니다.
    for (const [path, c] of merged) if (c.before === c.after) merged.delete(path)
    if (merged.size === 0) return refuse('INVALID_ARGUMENT', 'these files are the same as in the repository; nothing to change')
    if (merged.size > MAX_FILES) return refuse('EDIT_FORBIDDEN', `at most ${MAX_FILES} files can be changed in one ticket (this would be ${merged.size})`)

    let changedLines = 0
    for (const [path, c] of [...merged]) {
      const diff = lineDiff(c.before, c.after, MAX_CHANGED_LINES - changedLines)
      if (diff === null) return refuse('EDIT_FORBIDDEN', `at most ${MAX_CHANGED_LINES} changed lines in one ticket (added plus removed lines, over the whole ticket)`)
      // 끝 줄바꿈만 다른 파일은 바뀐 줄이 없다: 고친 것으로 치지 않는다.
      if (diff.added.length + diff.removed.length === 0) merged.delete(path)
      changedLines += diff.added.length + diff.removed.length
      if (diff.added.some(hasSecretValue)) return refuse('EDIT_FORBIDDEN', `${path} has an added line that looks like a secret value; secrets are never written to a repository`)
    }
    if (merged.size === 0) return refuse('INVALID_ARGUMENT', 'these files are the same as in the repository; nothing to change')
    if (hasSecretValue(message)) return refuse('EDIT_FORBIDDEN', 'the commit message contains a secret-looking value')

    const commitSha = await this.bot.commit(
      mine.fork,
      ticket.commitSha,
      mine.baseTree,
      mine.editBranch,
      [...merged].map(([path, c]) => ({ path, mode: c.mode, content: c.after })),
      message,
    )
    // 쓰는 동안 티켓이 끝났으면(forget이 busy를 지운다) 기록을 되살리지 않는다.
    if (!this.busy.has(ticket.ticketId)) return refuse('INVALID_ARGUMENT', 'the ticket ended while the commit was being made')
    mine.files = merged
    mine.sources.set(commitSha, { files: [...merged.keys()], changedLines })
    this.tickets.set(ticket.ticketId, mine)
    return { ok: true, content: { source: { commitSha }, files: [...merged.keys()], changedLines } }
  }

  private prune(): void {
    const cutoff = Date.now() - KEEP_MS
    for (const [id, t] of this.tickets) if (t.startedAt < cutoff) this.tickets.delete(id)
  }
}

const unavailable = () => refuse('BOT_UNAVAILABLE', 'the bot account is not configured on this platform (BOT_GITHUB_TOKEN is empty); report needs_user instead')

function fromBot(err: unknown): EditAnswer {
  if (!(err instanceof BotError)) throw err
  if (err.kind === 'none') return unavailable()
  if (err.kind === 'cannot-fork') return refuse('BOT_UNAVAILABLE', 'the bot account cannot fork this repository (it is private or forking is blocked); report needs_user instead')
  return refuse('BOT_UNAVAILABLE', 'GitHub did not accept the bot account request; try once more, or report needs_user')
}

/** edit_repo_file의 인자 검사. 틀리면 거절, 맞으면 정리한 경로 · 내용과 commit 메시지. */
export function checkEditArgs(args: { files?: unknown; message?: unknown }): { files: { path: string; content: string }[]; message: string } | Refusal {
  const { files, message } = args
  if (!Array.isArray(files) || files.length === 0) return refuse('INVALID_ARGUMENT', 'files must be a non-empty array of { path, content }')
  if (files.length > MAX_FILES) return refuse('EDIT_FORBIDDEN', `at most ${MAX_FILES} files can be changed in one ticket`)
  if (typeof message !== 'string' || message.trim() === '' || message.length > MAX_MESSAGE) {
    return refuse('INVALID_ARGUMENT', `message must be a string of 1 to ${MAX_MESSAGE} characters`)
  }
  const out: { path: string; content: string }[] = []
  for (const f of files) {
    if (!isRecord(f) || typeof f.path !== 'string' || typeof f.content !== 'string' || Object.keys(f).length !== 2) {
      return refuse('INVALID_ARGUMENT', 'each file must be { path: string, content: string } with the whole new content')
    }
    const path = repoPath(f.path)
    if (path === null || path === '') return refuse('INVALID_ARGUMENT', `path must be a file path relative to the repository root, got ${JSON.stringify(f.path.slice(0, 100))}`)
    const why = forbiddenPath(path)
    if (why) return refuse('EDIT_FORBIDDEN', `${path}: ${why}`)
    if (out.some((o) => o.path === path)) return refuse('INVALID_ARGUMENT', `${path} is listed twice`)
    if (Buffer.byteLength(f.content) > MAX_FILE_BYTES) return refuse('EDIT_FORBIDDEN', `${path}: content is larger than ${MAX_FILE_BYTES / 1024}KB`)
    if (f.content.includes('\0')) return refuse('EDIT_FORBIDDEN', `${path}: only text files can be written`)
    out.push({ path, content: f.content })
  }
  return { files: out, message: message.trim() }
}

/** 금지 경로면 이유. `.env`(와 `.env.*`) · `.github/`(CI 설정) · `.git/`은 고칠 수 없다. 대소문자는 가리지 않는다. */
function forbiddenPath(path: string): string | null {
  const parts = path.toLowerCase().split('/')
  const name = parts[parts.length - 1]
  if (name === '.env' || name.startsWith('.env.')) return '.env files are never written'
  if (parts[0] === '.github') return '.github/ is never changed'
  if (parts.includes('.git')) return '.git/ is never changed'
  return null
}
