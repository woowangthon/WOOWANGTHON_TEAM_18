import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import type { PreparedDeploy } from './deploy-condition.service.js'

/**
 * 배포 시작이 기대는 "준비됐을 때만 입력을 만든다"(#82 · #43). 준비가 안 됐으면 409 NOT_READY를 던지고,
 * 준비됐으면 `DeployConditionService.prepare(deployId, secretHash)`의 결과를 돌려준다. 소유 확인은 부르는 쪽이 한다.
 */
export abstract class DeployPreparer {
  abstract prepareIfReady(deployId: string): Promise<PreparedDeploy>
}

/** #82가 들어오기 전의 자리 채움. 준비 여부를 모르므로 시작을 받지 않는다. */
@Injectable()
export class UnavailableDeployPreparer extends DeployPreparer {
  prepareIfReady(): Promise<PreparedDeploy> {
    return Promise.reject(new ServiceUnavailableException({ code: 'NOT_IMPLEMENTED', message: 'Readiness check is not available yet' }))
  }
}
