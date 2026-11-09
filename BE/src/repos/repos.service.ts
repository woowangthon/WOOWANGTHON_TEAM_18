import {
  BadRequestException,
  ForbiddenException,
  type HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Env } from '../config/env.js'
import { parseRepoUrl, type RepoRef } from './repo-url.js'

const TIMEOUT_MS = 5000

const authUnavailable = () =>
  new ServiceUnavailableException({ code: 'AUTH_UNAVAILABLE', message: 'Could not check the linked GitHub account' })
const githubUnavailable = () =>
  new ServiceUnavailableException({ code: 'GITHUB_UNAVAILABLE', message: 'Could not reach GitHub' })

@Injectable()
export class ReposService {
  private readonly logger = new Logger(ReposService.name)
  private readonly supabaseUrl: string
  private readonly apiKey: string

  constructor(config: ConfigService<Env, true>) {
    this.supabaseUrl = config.get('SUPABASE_URL', { infer: true })
    this.apiKey = config.get('SUPABASE_PUBLISHABLE_KEY', { infer: true })
  }

  /** 로그인 계정에 연동된 GitHub 계정이 이 공개 개인 레포의 소유자인지 확인한다. 순서와 오류는 docs/design/auth.md. */
  async check(accessToken: string, repoUrl: unknown): Promise<{ repo: string }> {
    const ref = parseRepoUrl(repoUrl)
    if (!ref) {
      throw new BadRequestException({
        code: 'INVALID_REPO_URL',
        message: 'repoUrl must look like https://github.com/<owner>/<repo>',
      })
    }

    const githubId = await this.linkedGithubId(accessToken)
    if (!githubId) {
      throw new ForbiddenException({ code: 'GITHUB_NOT_LINKED', message: 'Link your GitHub account first' })
    }

    const repo = await this.fetchRepo(ref)
    if (repo.owner.type !== 'User') {
      throw new UnprocessableEntityException({
        code: 'REPO_NOT_PERSONAL',
        message: 'Only public personal repositories are supported',
      })
    }
    // 사용자명(login)은 바뀔 수 있어 숫자 ID로 비교한다.
    if (String(repo.owner.id) !== githubId) {
      throw new ForbiddenException({
        code: 'REPO_NOT_OWNED',
        message: 'The linked GitHub account does not own this repository',
      })
    }
    return { repo: repo.full_name }
  }

  // 사용자 토큰을 Supabase에 그대로 보내 identities를 읽는다. 로그아웃 · 폐기된 세션은 Supabase가 거부한다.
  private async linkedGithubId(accessToken: string): Promise<string | undefined> {
    const { status, ok, body } = await this.request(
      `${this.supabaseUrl}/auth/v1/user`,
      { Authorization: `Bearer ${accessToken}`, apikey: this.apiKey },
      authUnavailable,
    )
    // 사용자 쪽 토큰 문제(위조 · 만료 · 로그아웃)는 403이다. 401은 우리 공개 키가 틀렸을 때 나오므로 아래에서 503이 된다.
    if (status === 403) {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Invalid or expired login token' })
    }
    const identities = (body as SupabaseUser | undefined)?.identities
    if (!ok || !Array.isArray(identities)) {
      this.logger.error(`Supabase GET /auth/v1/user answered ${status} without identities (401 means SUPABASE_PUBLISHABLE_KEY was refused)`)
      throw authUnavailable()
    }
    const github = identities.find((i) => i.provider === 'github')
    if (!github) return undefined
    if (typeof github.id !== 'string' || github.id === '') {
      this.logger.error('Supabase github identity has no string id')
      throw authUnavailable()
    }
    return github.id
  }

  // 인증 없이 공개 레포만 본다. 사용자 토큰은 GitHub에 보내지 않는다.
  private async fetchRepo({ owner, repo }: RepoRef): Promise<GithubRepo> {
    const { status, ok, body } = await this.request(
      `https://api.github.com/repos/${owner}/${repo}`,
      { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'woowangthon-platform' },
      githubUnavailable,
    )
    // 없는 레포와 비공개 레포는 GitHub가 둘 다 404로 답한다.
    if (status === 404) {
      throw new NotFoundException({ code: 'REPO_NOT_FOUND', message: 'No public repository found at that address' })
    }
    if (!ok || !isGithubRepo(body)) {
      // 한도 초과(403 · 429) · GitHub 장애 · 예상 밖 응답은 사용자 잘못이 아니다.
      this.logger.error(`GitHub GET /repos/${owner}/${repo} answered ${status}`)
      throw githubUnavailable()
    }
    return body
  }

  // 외부 호출 하나. 5초 제한을 걸고, 오류 응답이어도 본문을 끝까지 읽어 연결이 풀로 돌아가게 한다.
  // 닿지 못하면(네트워크 · 시간 초과) 로그를 남기고 unavailable()을 던진다. 본문이 JSON이 아니면 body는 undefined다.
  private async request(url: string, headers: Record<string, string>, unavailable: () => HttpException) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
      const body: unknown = await res.json().catch(() => undefined)
      return { status: res.status, ok: res.ok, body }
    } catch (err) {
      this.logger.error(err)
      throw unavailable()
    }
  }
}

interface SupabaseUser {
  identities?: { provider?: unknown; id?: unknown }[]
}

interface GithubRepo {
  full_name: string
  owner: { id: number; type: string }
}

function isGithubRepo(value: unknown): value is GithubRepo {
  const { full_name, owner } = (value ?? {}) as { full_name?: unknown; owner?: { id?: unknown; type?: unknown } | null }
  return typeof full_name === 'string' && typeof owner?.id === 'number' && typeof owner.type === 'string'
}
