import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { ClusterCapacity } from '../k8s/cluster-capacity.js'
import { AgentClient } from './agent.client.js'
import { commitOf } from './deploy-run.js'
import { type DeployRunRow, DeploysStore } from './deploys.store.js'
import { PipelineClient } from './pipeline.client.js'

/** 빌드 제한(15분)의 두 배. running이 이보다 오래 바뀌지 않았으면 멈춘 것으로 보고 마감한다. */
export const QUEUE_STALE_MS = 30 * 60_000
/**
 * 게이트웨이 토큰이 만료된 `fixing`을 마감하기 전 여유. 만료 직전에 토큰 검사를 통과한 submit_result가 아직 실행 기록을 바꾸는 중일 수 있다
 * (verified는 이전 시험이 끝났는지 확인한다). 시험을 기다리는 티켓은 대기 상한까지 토큰을 먼저 늘리므로(gateway/tools.ts) 만료된 토큰은 시험 대기 중이 아니다.
 */
export const FIXING_GRACE_MS = 2 * 60_000
// 게이트웨이 쪽 종료(gave_up · needs_user), 재시작, 놓친 알림으로 줄이 멈추지 않게 이 간격으로 다시 본다.
const TICK_MS = 15_000

/**
 * 배포 대기열(docs/design/deploy-workflow.md "배포 대기열"). 시작한 배포는 `queued`로 저장되고, 여기서 한 번에 하나씩 `running`으로 바꾸며 파이프라인을 부른다.
 * 출발 조건: 도는 `running`이 없고, 클러스터에 자리가 있다. `fixing`(AI가 고치는 중)은 줄을 막지 않는다. BE는 컨테이너 하나라 프로세스 안의 줄이면 충분하다.
 * 게이트웨이 토큰이 만료된 `fixing`은 더 결과를 받을 수 없으므로(TICKET_CLOSED) 여기서 TIMED_OUT으로 마감한다.
 */
@Injectable()
export class DeployQueue implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DeployQueue.name)
  private chain: Promise<void> = Promise.resolve()
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly store: DeploysStore,
    private readonly pipeline: PipelineClient,
    private readonly agent: AgentClient,
    private readonly capacity: ClusterCapacity,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => this.kick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    clearInterval(this.timer)
  }

  /** 줄을 한 번 본다. 기다리지 않는다. 겹쳐 불려도 하나씩 차례로 돈다. */
  kick(): void {
    this.chain = this.chain.then(() => this.advance()).catch((err: unknown) => this.logger.error(`deploy queue stopped: ${err instanceof Error ? err.message : String(err)}`))
  }

  /** 줄에 선 일이 모두 끝날 때까지(시험용). */
  idle(): Promise<void> {
    return this.chain
  }

  /** 한 번에 하나만 출발시킨다. */
  private async advance(): Promise<void> {
    for (const stuck of await this.store.findExpiredFixing(new Date(Date.now() - FIXING_GRACE_MS))) await this.expire(stuck)
    for (;;) {
      const running = await this.store.findRunning()
      if (running) {
        if (Date.now() - Date.parse(running.updated_at) < QUEUE_STALE_MS) return
        if (!(await this.expire(running))) return
        continue
      }
      const next = await this.store.findOldestQueued()
      if (!next || (await this.capacity.isFull())) return
      // 파이프라인을 부르지 못한 배포는 실패로 두고 다음 배포를 본다. 그 밖에는(출발했거나 다른 곳이 먼저 바꿨다) 이번 확인을 끝낸다.
      if (!(await this.depart(next))) return
    }
  }

  /** queued → running/build로 바꾸고 파이프라인을 부른다. 파이프라인을 부르지 못해 실패로 마감했으면 true(다음 배포를 본다). */
  private async depart(run: DeployRunRow): Promise<boolean> {
    const claimed = await this.store.updateRun(run.deploy_id, { status: 'queued' }, { status: 'running', stage: 'build' })
    if (!claimed) return false
    try {
      await this.pipeline.run(run.deploy_id)
      return false
    } catch (err) {
      this.logger.error(`could not start the pipeline for ${run.slug}: ${err instanceof Error ? err.name : 'error'}`)
      await this.store.updateRun(run.deploy_id, { status: 'running' }, { status: 'failed', failure: { code: 'PIPELINE_UNAVAILABLE', stage: 'build', service: null } })
      return true
    }
  }

  /**
   * 오래 바뀌지 않은 진행 중 실행을 TIMED_OUT으로 마감한다(읽은 뒤 바뀌지 않았을 때만: 상태와 `updated_at`이 그대로). 마감했으면 true.
   * 읽은 직후 알림이 스테이지를 넘겼다면 정상 실행이므로 건드리지 않는다.
   * 에이전트가 아직 그 티켓을 붙잡고 있을 수 있다(fixing, 또는 verified 뒤 다시 실행 중인 running). 멈추라고 알린다(받지 못해도 실행 기록은 이미 끝났다).
   */
  async expire(active: DeployRunRow): Promise<boolean> {
    const expired = await this.store.updateRun(
      active.deploy_id,
      { status: active.status, updatedAt: active.updated_at },
      { status: 'failed', failure: { code: 'TIMED_OUT', stage: active.stage ?? 'build', service: null } },
    )
    if (expired && active.ticket_id) await this.agent.close(active.ticket_id, commitOf(active), 'stopped')
    return expired
  }
}
