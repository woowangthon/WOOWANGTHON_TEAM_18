import { Injectable, NotFoundException } from '@nestjs/common'
import { ReposService } from '../repos/repos.service.js'
import { buildInputHash, type ServiceConditions, type Slot, targetSlot } from './deploy-condition.js'
import type { Spec } from './deploy-input.js'
import { DeploysStore } from './deploys.store.js'

/** W4에 넘기는 배포 입력. 모양은 docs/design/deploy-handoff.md. */
export interface DeployInput {
  commitSha: string
  deploy_condition: { secretHash: string | null; services: ServiceConditions }
  spec: Spec
}

/** 이번 실행이 올릴 슬롯과 그 슬롯의 배포 입력. */
export interface PreparedDeploy {
  deployId: string
  slot: Slot
  input: DeployInput
}

@Injectable()
export class DeployConditionService {
  constructor(
    private readonly repos: ReposService,
    private readonly store: DeploysStore,
  ) {}

  /**
   * W4 시작 때 저장한 배포 입력(`deployId`)으로 이번 실행의 조건을 만든다: 대상 슬롯은 DB `live_slot`의 반대쪽(첫 배포는 A),
   * 서비스마다 commit 시점의 컨텍스트 폴더 tree SHA · Dockerfile blob SHA · spec.build · 기본 Dockerfile 버전으로 빌드 입력 해시를 내고,
   * `build_cache`에 같은 해시의 이미지가 있으면 reuse, 없으면 run이다. 아무것도 저장하지 않는다(슬롯 줄은 Prepare가 바꾼다).
   * `secretHash`는 W3이 Secret에 넣은 값들의 해시다.
   */
  async prepare(deployId: string, secretHash: string | null): Promise<PreparedDeploy> {
    const row = await this.store.findById(deployId)
    if (!row) throw new NotFoundException({ code: 'DEPLOY_NOT_FOUND', message: 'No such deploy' })
    const { spec } = row
    const [owner, repo] = row.repo.split('/')

    const slot = targetSlot(await this.store.liveSlot(row.slug))
    const shas = await this.repos.sourceShas({ owner, repo }, row.commit_sha, {
      trees: spec.services.map((s) => s.build.context),
      blobs: spec.services.flatMap((s) => (s.build.dockerfile === null ? [] : [s.build.dockerfile])),
    })

    const services: ServiceConditions = {}
    for (const svc of spec.services) {
      const { context, dockerfile } = svc.build
      // sourceShas는 요청한 경로를 모두 채우거나 던진다.
      const hash = buildInputHash(svc.build, { contextTree: shas.get(context)!, dockerfileBlob: dockerfile === null ? null : shas.get(dockerfile)! })
      const image = await this.store.cachedImage(row.slug, svc.name, hash)
      services[svc.name] = { buildInputHash: hash, build: image === null ? 'run' : 'reuse', image }
    }
    return { deployId, slot, input: { commitSha: row.commit_sha, deploy_condition: { secretHash, services }, spec } }
  }
}
