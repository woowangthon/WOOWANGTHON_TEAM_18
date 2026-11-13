import { Injectable, Logger } from '@nestjs/common'
import { ClusterReader } from '../k8s/cluster-reader.js'
import { DeploymentScaler } from '../k8s/deployment-scaler.js'
import type { Slot } from './deploy-condition.js'
import { DeploysStore } from './deploys.store.js'

/**
 * 슬롯의 Deployment(`<서비스>-<슬롯>`)를 0개로 내린다. 두 곳이 쓴다:
 * - W7: 배포가 성공한 뒤 이전 live 슬롯 정리(`scaleDown`).
 * - 배포가 끝내 실패한 뒤 대상 슬롯 정리(`afterFailure`): 준비가 안 되는 Pod가 계속 재시작하지 않게 한다.
 * 둘 다 실패해도 던지지 않는다(남은 Pod는 자원만 쓴다. 운영자 강제 중지로 내릴 수 있다). 같은 호출을 다시 해도 같은 결과다(이미 0이어도 0으로 쓴다).
 */
@Injectable()
export class SlotScaleDown {
  private readonly logger = new Logger(SlotScaleDown.name)

  constructor(
    private readonly store: DeploysStore,
    private readonly reader: ClusterReader,
    private readonly scaler: DeploymentScaler,
  ) {}

  /** `why`는 로그 앞머리다(W7 · failed slot). */
  async scaleDown(slug: string, slot: Slot, why = 'W7'): Promise<void> {
    try {
      const names = (await this.reader.deployments(slug)).map((d) => d.name).filter((name) => name.endsWith(`-${slot}`))
      const results = await Promise.allSettled(names.map((name) => this.scaler.scaleToZero(slug, name)))
      results.forEach((r, i) => {
        if (r.status === 'rejected') this.logger.error(`${why}: could not scale ${slug} ${names[i]} to 0: ${r.reason instanceof Error ? r.reason.message : 'unknown'}`)
      })
    } catch (err) {
      this.logger.error(`${why}: could not list deployments of ${slug} to scale slot ${slot} down: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  /**
   * 실패로 끝난 배포의 대상 슬롯을 내린다. 아래는 건드리지 않는다:
   * - apply · verify가 아닌 단계의 실패: 대상 슬롯에 이 실행이 띄운 것이 없거나(build · prepare · render), 전환이 중간에 끊겼을 수 있다(switch).
   * - live 슬롯, 그리고 같은 프로젝트에서 다른 실행이 이미 시작됐을 때(그 실행이 같은 슬롯을 쓸 수 있다).
   * `slotTouched`: 앞 단계(build · prepare · render)에서 실패했어도 AI 에이전트의 시험 배포(run_deploy)가 이 슬롯에 Pod를 올렸으면 true다. switch는 그래도 건드리지 않는다.
   * AI 에이전트가 고치는 동안(`fixing`)은 부르지 않는다: 에이전트가 이 슬롯의 Pod 로그 · 이벤트를 읽는다.
   */
  async afterFailure(run: { slug: string; target_slot: Slot }, stage: string | null, slotTouched = false): Promise<void> {
    const ran = stage === 'apply' || stage === 'verify'
    if (!ran && !(slotTouched && (stage === 'build' || stage === 'prepare' || stage === 'render'))) return
    try {
      const [live, active] = await Promise.all([this.store.liveSlot(run.slug), this.store.findActiveRun(run.slug)])
      if (live === run.target_slot || active) return
    } catch (err) {
      this.logger.error(`failed slot: could not check ${run.slug} before scaling its failed slot down: ${err instanceof Error ? err.message : 'unknown'}`)
      return
    }
    await this.scaleDown(run.slug, run.target_slot, 'failed slot')
  }
}
