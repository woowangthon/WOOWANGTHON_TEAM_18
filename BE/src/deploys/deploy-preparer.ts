import type { PreparedDeploy } from './deploy-condition.service.js'

/**
 * 배포 시작이 기대는 "준비됐을 때만 입력을 만든다"(#82 · #43). 준비가 안 됐으면 409 NOT_READY를 던지고,
 * 준비됐으면 `DeployConditionService.prepare(deployId, secretHash)`의 결과를 돌려준다. 소유 확인은 부르는 쪽이 한다.
 * 구현은 `DeployReadinessService`이고 `DeploysModule`이 이 토큰에 묶는다.
 */
export abstract class DeployPreparer {
  abstract prepareIfReady(deployId: string): Promise<PreparedDeploy>
}
