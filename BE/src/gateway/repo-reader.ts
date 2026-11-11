import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { isRecord } from '../common/is-record.js'

const TIMEOUT_MS = 10_000
/** 파일 내용은 이만큼까지 준다(api.md `read_repo`: 200KB 넘으면 자름). */
export const MAX_FILE_BYTES = 200 * 1024
const GITHUB_HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'woowangthon-platform' }
const RAW_HEADERS = { 'User-Agent': 'woowangthon-platform' }

export type RepoEntry =
  | { type: 'dir'; entries: { name: string; type: 'file' | 'dir'; size: number }[] }
  | { type: 'file'; content: string; truncated: boolean }

const unavailable = () => new ServiceUnavailableException({ code: 'GITHUB_UNAVAILABLE', message: 'Could not read the repository' })

/** 레포 안 상대 경로. `.`은 루트다. 위로 올라가거나 절대 경로면 null. */
export function repoPath(path: string): string | null {
  if (path === '.' || path === '') return ''
  if (path.length > 400 || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return null
  const parts = path.split('/').filter((p) => p !== '' && p !== '.')
  if (parts.some((p) => p === '..')) return null
  return parts.join('/')
}

/**
 * 공개 레포의 한 commit 시점 파일 · 폴더를 읽는다(인증 없이, 서버 IP당 시간당 60번인 GitHub API 한도에 잡힌다).
 * 폴더는 contents API, 큰 파일은 raw로 읽는다. 없으면 null.
 */
@Injectable()
export class RepoReader {
  private readonly logger = new Logger(RepoReader.name)

  async read(repo: string, commitSha: string, path: string): Promise<RepoEntry | null> {
    const encoded = path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
    const res = await this.get(`https://api.github.com/repos/${repo}/contents${encoded ? `/${encoded}` : ''}?ref=${commitSha}`, GITHUB_HEADERS)
    if (res === null) return null
    const body: unknown = JSON.parse(res)
    if (Array.isArray(body)) {
      return {
        type: 'dir',
        entries: body.filter(isRecord).map((e) => ({
          name: String(e.name),
          type: e.type === 'dir' ? 'dir' : 'file',
          size: typeof e.size === 'number' ? e.size : 0,
        })),
      }
    }
    if (!isRecord(body)) throw unavailable()
    let bytes: Buffer
    if (typeof body.content === 'string' && body.content !== '' && body.encoding === 'base64') {
      bytes = Buffer.from(body.content, 'base64')
    } else {
      // 1MB가 넘는 파일은 contents API가 내용을 주지 않는다.
      const raw = await this.get(`https://raw.githubusercontent.com/${repo}/${commitSha}/${encoded}`, RAW_HEADERS)
      if (raw === null) return null
      bytes = Buffer.from(raw)
    }
    const truncated = bytes.length > MAX_FILE_BYTES
    return { type: 'file', content: bytes.subarray(0, MAX_FILE_BYTES).toString('utf8'), truncated }
  }

  private async get(url: string, headers: Record<string, string>): Promise<string | null> {
    let res: Response
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (err) {
      this.logger.error(err)
      throw unavailable()
    }
    const text = await res.text()
    if (res.status === 404) return null
    if (!res.ok) {
      this.logger.error(`GitHub answered ${res.status} to a repository read`)
      throw unavailable()
    }
    return text
  }
}
