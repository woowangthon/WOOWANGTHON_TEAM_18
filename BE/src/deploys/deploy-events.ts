import { Injectable } from '@nestjs/common'

/**
 * 실행 기록이 끝 상태(succeeded · failed · needs_user)로 바뀌었다는 알림. 끝내는 곳이 여러 군데(파이프라인 알림 · 대기열 · 게이트웨이)라
 * 실제로 바꾼 `DeploysStore.updateRun` 한 곳에서 낸다. 듣는 쪽(배포 결과 Discord)은 자기 오류를 스스로 삼킨다.
 */
@Injectable()
export class DeployEvents {
  private readonly listeners: ((deployId: string) => void)[] = []

  onEnded(fn: (deployId: string) => void): void {
    this.listeners.push(fn)
  }

  ended(deployId: string): void {
    for (const fn of this.listeners) fn(deployId)
  }
}
