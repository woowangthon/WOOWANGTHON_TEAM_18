import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { type PreparedDeploy, DeployConditionService } from './deploy-condition.service.js'
import { MAX_ISSUES } from './deploy-input.js'
import { DeploysStore } from './deploys.store.js'
import { SecretsService } from './secrets.service.js'

/**
 * 배포 시작(#44)이 부르는 "준비됐을 때만 입력을 만든다"(#82). 모든 서비스의 `secretKeys`에 값이 들어갔을 때만(W3의 상태, GET .../secrets의 `ready`와 같은 판단)
 * `DeployConditionService.prepare`를 부르고, 아니면 `409 NOT_READY`에 빠진 key를 `secrets.<서비스>.<KEY>`로 싣는다(이름만, 값은 없다).
 * 소유 확인은 부르는 쪽이 한다(이 함수는 사용자를 모른다). 계약은 docs/design/api.md "비밀값".
 */
@Injectable()
export class DeployReadinessService {
  constructor(
    private readonly store: DeploysStore,
    private readonly secrets: SecretsService,
    private readonly condition: DeployConditionService,
  ) {}

  async prepareIfReady(deployId: string): Promise<PreparedDeploy> {
    const row = await this.store.findById(deployId)
    if (!row) throw new NotFoundException({ code: 'DEPLOY_NOT_FOUND', message: 'No such deploy' })
    const status = await this.secrets.statusOf(row.spec)
    if (!status.ready) {
      const fields = status.services.flatMap((s) => s.keys.filter((k) => k.status === 'missing').map((k) => ({ path: `secrets.${s.name}.${k.key}`, code: 'REQUIRED' })))
      throw new ConflictException({ code: 'NOT_READY', message: `secrets are not ready (first: ${fields[0].path})`, fields: fields.slice(0, MAX_ISSUES) })
    }
    return this.condition.prepare(deployId, status.secretHash)
  }
}
