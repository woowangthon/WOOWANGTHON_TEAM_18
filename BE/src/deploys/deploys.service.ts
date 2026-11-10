import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../auth/auth.decorators.js'
import { isCommitSha } from '../repos/repo-url.js'
import { invalidCommit, ReposService } from '../repos/repos.service.js'
import { type Issue, type Spec, validateSpec } from './deploy-input.js'
import { type DeployRow, DeploysStore } from './deploys.store.js'

const invalidSpec = (message: string, fields: Issue[]) => new BadRequestException({ code: 'INVALID_SPEC', message, fields })
// 대소문자는 GitHub가 구분하지 않는다.
const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 저장한 배포 입력. 모양은 docs/design/api.md의 "배포 입력 저장". */
export interface Deploy {
  id: string
  repo: string
  commit: string
  spec: Spec
  createdAt: string
}

const toDeploy = (row: DeployRow): Deploy => ({
  id: row.id,
  repo: row.repo,
  commit: row.commit_sha,
  spec: row.spec,
  // Postgres는 `2026-11-10T01:00:00.123456+00:00`처럼 준다. 계약은 UTC ISO 8601이다.
  createdAt: new Date(row.created_at).toISOString(),
})

@Injectable()
export class DeploysService {
  constructor(
    private readonly repos: ReposService,
    private readonly store: DeploysStore,
  ) {}

  /**
   * 사용자가 고친 spec과 접수 때 확정한 commit을 확인하고 저장한다. 확인 순서는 docs/design/api.md:
   * 모양(외부 호출 없음) → 소유 확인 → commit이 이 레포의 것인지 → spec의 레포가 확인한 레포인지 → slug 충돌 → 저장.
   */
  async create(user: AuthUser, accessToken: string, repoUrl: unknown, commit: unknown, input: unknown): Promise<Deploy> {
    const ref = this.repos.requireRepoRef(repoUrl)
    if (!isCommitSha(commit)) throw invalidCommit()
    const checked = validateSpec(input)
    if (!checked.ok) {
      throw invalidSpec(`spec has invalid fields (first: ${checked.issues[0].path})`, checked.issues)
    }
    const { spec } = checked

    const { repo } = await this.repos.verifyOwnership(accessToken, repoUrl)
    await this.repos.assertCommit(ref, commit)
    // 저장하는 값은 GitHub가 돌려준 표기다.
    if (!sameRepo(spec.project.repo, repo.full_name)) {
      throw invalidSpec('spec.project.repo is not the repository that was checked', [{ path: 'project.repo', code: 'MISMATCH' }])
    }

    // 네임스페이스 proj-<slug>와 공개 주소가 slug로 정해지므로 같은 사용자의 같은 레포만 다시 쓸 수 있다.
    // 읽고 나서 쓰기라 동시에 처음 쓰는 두 요청은 둘 다 통과할 수 있다(docs/design/auth.md 알려진 한계).
    const owner = await this.store.findSlugOwner(spec.project.slug)
    if (owner && (owner.user_id !== user.id || !sameRepo(owner.repo, repo.full_name))) {
      throw new ConflictException({ code: 'SLUG_TAKEN', message: 'This slug is used by another project' })
    }

    return toDeploy(
      await this.store.insert({ user_id: user.id, slug: spec.project.slug, repo: repo.full_name, commit_sha: commit, spec }),
    )
  }

  /** 내 배포 입력 하나. 없는 id · 남의 id · UUID가 아닌 id는 모두 404다(남의 배포가 있는지 알려 주지 않는다). */
  async get(user: AuthUser, id: string): Promise<Deploy> {
    const row = UUID.test(id) ? await this.store.findOwned(id.toLowerCase(), user.id) : undefined
    if (!row) throw new NotFoundException({ code: 'DEPLOY_NOT_FOUND', message: 'No such deploy' })
    return toDeploy(row)
  }
}
