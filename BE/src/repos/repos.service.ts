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
import { buildProjects, type DeployProject, join, selectPackageDirs } from './deploy-spec.js'
import { isCommitSha, parseRepoUrl, type RepoRef } from './repo-url.js'

const TIMEOUT_MS = 5000
// 실제 package.json은 수 KB다. 이보다 큰 파일은 읽지 않아(메모리를 지키려는 것) 판단 필요로 둔다.
const MAX_PACKAGE_JSON_BYTES = 1_000_000
// 이름이 정확히 Dockerfile인 파일만(루트 또는 하위 폴더). Dockerfile.prod · *.Dockerfile은 MVP 제외.
const DOCKERFILE_PATH = /(^|\/)Dockerfile$/
// package.json 내용은 API 한도에 잡히지 않는 raw 주소로 읽는다(한도 헤더가 없다). 인증 없이 공개 레포만 본다.
const RAW_HEADERS = { 'User-Agent': 'woowangthon-platform' }
const GITHUB_HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'woowangthon-platform' }
// commits/{rev}를 이 형식으로 부르면 JSON(수 KB, 바뀐 파일 목록까지) 대신 40자 SHA 텍스트만 온다.
const GITHUB_SHA_HEADERS = { ...GITHUB_HEADERS, Accept: 'application/vnd.github.sha' }

const authUnavailable = () =>
  new ServiceUnavailableException({ code: 'AUTH_UNAVAILABLE', message: 'Could not check the linked GitHub account' })
const githubUnavailable = () =>
  new ServiceUnavailableException({ code: 'GITHUB_UNAVAILABLE', message: 'Could not reach GitHub' })
const invalidCommit = () =>
  new BadRequestException({ code: 'INVALID_COMMIT', message: 'commit must be a full 40-character lowercase hex SHA' })

@Injectable()
export class ReposService {
  private readonly logger = new Logger(ReposService.name)
  private readonly supabaseUrl: string
  private readonly apiKey: string

  constructor(config: ConfigService<Env, true>) {
    this.supabaseUrl = config.get('SUPABASE_URL', { infer: true })
    this.apiKey = config.get('SUPABASE_PUBLISHABLE_KEY', { infer: true })
  }

  /**
   * 로그인 계정에 연동된 GitHub 계정이 이 공개 개인 레포의 소유자인지 확인하고, 통과하면 접수할 commit(기본 브랜치 HEAD의 전체 SHA)을 확정한다.
   * 커밋이 없는 빈 레포는 commit이 null이다. 순서와 오류는 docs/design/auth.md.
   */
  async check(accessToken: string, repoUrl: unknown): Promise<{ repo: string; commit: string | null }> {
    const { ref, repo } = await this.verifyOwnership(accessToken, repoUrl)
    // 409는 커밋이 없는 빈 레포다(오류가 아니다).
    return { repo: repo.full_name, commit: await this.fetchCommit(ref, 'HEAD', [409]) }
  }

  /** 소유 확인을 통과한 레포의 Dockerfile 경로를 모두 찾는다. 없으면 빈 목록이다(오류가 아니다). */
  async dockerfiles(accessToken: string, repoUrl: unknown): Promise<DockerfilesResult> {
    const { ref, repo } = await this.verifyOwnership(accessToken, repoUrl)
    const tree = await this.fetchTree(ref, 'HEAD')
    const dockerfiles = tree.tree.filter((e) => e.type === 'blob' && DOCKERFILE_PATH.test(e.path)).map((e) => e.path)
    return { repo: repo.full_name, dockerfiles, truncated: tree.truncated }
  }

  /**
   * 소유 확인을 통과한 레포의 배포 설정 초안을 만든다: 폴더마다 package.json과 락 파일 이름으로 프레임워크 · 패키지 매니저 · 명령을 채운다.
   * 저장하지 않고 호출할 때마다 계산한다. package.json이 없으면 빈 목록이다(오류가 아니다). 규칙은 docs/design/api.md.
   * commit이 있으면(null도 없는 것으로 본다) 그 commit의 파일을, 없으면 HEAD를 읽는다.
   */
  async deploySpec(accessToken: string, repoUrl: unknown, requested?: unknown): Promise<DeploySpecResult> {
    const commit = requestedCommit(requested)
    const { ref, repo } = await this.verifyOwnership(accessToken, repoUrl)
    if (commit) await this.assertCommit(ref, commit)
    const rev = commit ?? 'HEAD'
    const tree = await this.fetchTree(ref, rev)
    // 파일 경로 → 크기. 크기는 큰 package.json을 읽기 전에 거르는 데 쓴다.
    const files = new Map(tree.tree.filter((e) => e.type === 'blob').map((e): [string, number | undefined] => [e.path, e.size]))
    const { dirs, truncated } = selectPackageDirs(files.keys())
    const packages = await Promise.all(
      dirs.map((dir) => {
        const file = join(dir, 'package.json')
        return this.fetchPackageJson(ref, rev, file, files.get(file))
      }),
    )
    return { repo: repo.full_name, commit, projects: buildProjects(dirs, packages, files), truncated: tree.truncated || truncated }
  }

  /** repoUrl을 소유자 · 레포 이름으로 푼다. 모양이 틀리면 400 INVALID_REPO_URL이고 외부 호출은 없다. */
  requireRepoRef(repoUrl: unknown): RepoRef {
    const ref = parseRepoUrl(repoUrl)
    if (!ref) {
      throw new BadRequestException({
        code: 'INVALID_REPO_URL',
        message: 'repoUrl must look like https://github.com/<owner>/<repo>',
      })
    }
    return ref
  }

  /** 로그인 계정에 연동된 GitHub 계정이 이 공개 개인 레포의 소유자인지 확인한다. 순서와 오류는 docs/design/auth.md. */
  async verifyOwnership(accessToken: string, repoUrl: unknown): Promise<{ ref: RepoRef; repo: GithubRepo }> {
    const ref = this.requireRepoRef(repoUrl)

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
    return { ref, repo }
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
      GITHUB_HEADERS,
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

  // rev는 HEAD(기본 브랜치) 또는 확인을 마친 commit SHA다. 소유 확인을 이미 통과한 레포라 아래를 뺀 실패는 사용자 잘못이 아니다(404 포함).
  private async fetchTree({ owner, repo }: RepoRef, rev: string): Promise<GithubTree> {
    const { status, ok, body } = await this.request(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${rev}?recursive=1`,
      GITHUB_HEADERS,
      githubUnavailable,
    )
    // 커밋이 없는 빈 레포는 GitHub가 409 "Git Repository is empty."로 답한다. 파일이 없다는 정상 상태다.
    if (status === 409) return { tree: [], truncated: false }
    if (!ok || !isGithubTree(body)) {
      this.logger.error(`GitHub GET /repos/${owner}/${repo}/git/trees answered ${status}`)
      throw githubUnavailable()
    }
    return body
  }

  // 읽는 사이 파일이 사라져 404이면 못 읽은 것으로 두고(그 폴더만 판단 필요), JSON이 아니어도 마찬가지다. 한도 · 장애는 503이다.
  private async fetchPackageJson({ owner, repo }: RepoRef, rev: string, file: string, size: number | undefined): Promise<unknown> {
    if (typeof size === 'number' && size > MAX_PACKAGE_JSON_BYTES) return undefined
    const path = file.split('/').map(encodeURIComponent).join('/')
    const { status, ok, body } = await this.request(
      `https://raw.githubusercontent.com/${owner}/${repo}/${rev}/${path}`,
      RAW_HEADERS,
      githubUnavailable,
    )
    if (status === 404) return undefined
    if (!ok) {
      this.logger.error(`GitHub raw ${owner}/${repo}/${rev}/${path} answered ${status}`)
      throw githubUnavailable()
    }
    return body
  }

  // rev(HEAD 또는 SHA)가 가리키는 commit의 전체 SHA. missing에 든 상태 코드는 "그 commit이 없다"는 뜻이라 null이고, 그 밖의 실패는 503이다.
  private async fetchCommit({ owner, repo }: RepoRef, rev: string, missing: number[]): Promise<string | null> {
    const { status, ok, text } = await this.request(
      `https://api.github.com/repos/${owner}/${repo}/commits/${rev}`,
      GITHUB_SHA_HEADERS,
      githubUnavailable,
    )
    if (missing.includes(status)) return null
    // sha 미디어 타입의 답은 개행 없이 40자 그대로다(2026-11-10 확인). 그렇지 않으면 모양 검사에서 걸려 503이다.
    if (!ok || !isCommitSha(text)) {
      this.logger.error(`GitHub GET /repos/${owner}/${repo}/commits/${rev} answered ${status}`)
      throw githubUnavailable()
    }
    return text
  }

  // git/trees는 commit이 아닌 tree SHA도 받는데 그 SHA로는 raw 파일이 404다. 그대로 두면 모든 package.json이 조용히 "읽을 수 없음"이 되므로 먼저 commit인지 본다.
  // GitHub는 없는 SHA · tree SHA · 다른 레포의 SHA에 422로 답한다(2026-11-10 실제 응답).
  async assertCommit(ref: RepoRef, sha: string): Promise<void> {
    if ((await this.fetchCommit(ref, sha, [404, 409, 422])) !== sha) {
      throw new NotFoundException({ code: 'COMMIT_NOT_FOUND', message: 'No such commit in this repository' })
    }
  }

  // 외부 호출 하나. 5초 제한을 걸고, 오류 응답이어도 본문을 끝까지 읽어 연결이 풀로 돌아가게 한다.
  // 닿지 못하면(네트워크 · 시간 초과) 로그를 남기고 unavailable()을 던진다. 본문이 JSON이 아니면 body는 undefined이고, 원문은 text다.
  private async request(url: string, headers: Record<string, string>, unavailable: () => HttpException) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
      const text = await res.text()
      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        body = undefined
      }
      return { status: res.status, ok: res.ok, body, text }
    } catch (err) {
      this.logger.error(err)
      throw unavailable()
    }
  }
}

interface SupabaseUser {
  identities?: { provider?: unknown; id?: unknown }[]
}

export interface GithubRepo {
  full_name: string
  owner: { id: number; type: string }
}

interface GithubTreeEntry {
  path: string
  type: string
  size?: number
}

interface GithubTree {
  tree: GithubTreeEntry[]
  truncated: boolean
}

export interface DeploySpecResult {
  repo: string
  commit: string | null
  projects: DeployProject[]
  truncated: boolean
}

export interface DockerfilesResult {
  repo: string
  dockerfiles: string[]
  truncated: boolean
}

// commit이 없으면(undefined · null) null, 전체 SHA면 그 값이고, 그 밖의 값은 400이다.
function requestedCommit(input: unknown): string | null {
  if (input === undefined || input === null) return null
  if (!isCommitSha(input)) throw invalidCommit()
  return input
}

function isGithubTree(value: unknown): value is GithubTree {
  const { tree, truncated } = (value ?? {}) as { tree?: unknown; truncated?: unknown }
  return (
    typeof truncated === 'boolean' &&
    Array.isArray(tree) &&
    tree.every((e) => {
      const { path, type } = (e ?? {}) as Partial<GithubTreeEntry>
      return typeof path === 'string' && typeof type === 'string'
    })
  )
}

function isGithubRepo(value: unknown): value is GithubRepo {
  const { full_name, owner } = (value ?? {}) as { full_name?: unknown; owner?: { id?: unknown; type?: unknown } | null }
  return typeof full_name === 'string' && typeof owner?.id === 'number' && typeof owner.type === 'string'
}
