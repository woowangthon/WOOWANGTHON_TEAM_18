import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { redactString } from '../common/redact.js'
import type { Env } from '../config/env.js'
import { SLUG } from '../deploys/deploy-input.js'
import { DeploysStore } from '../deploys/deploys.store.js'
import { ClusterError } from '../k8s/cluster-error.js'
import { type AlertInfo, ClusterReader } from '../k8s/cluster-reader.js'
import { DeploymentScaler } from '../k8s/deployment-scaler.js'
import { DiscordNotifier } from './discord.notifier.js'
import { IncidentJudge } from './incident-judge.js'
import { operatorMessage, studentMessage } from './incident-text.js'
import { emptyAi, type IncidentRow, IncidentsStore } from './incidents.store.js'

const TICK_MS = 20_000
// 규칙 코드가 바로 멈추는 경고. 나머지는 AI가 판단하고 사람이 정한다.
export const AUTO_STOP = 'KubePodCrashLooping'
// 늘 울리는 점검용 · 감시 도구 자신의 경고는 보지 않는다.
const IGNORED = (name: string) => name === 'Watchdog' || name === 'InfoInhibitor' || name.startsWith('Prometheus')
// 저장 · AI로 보내는 라벨. 나머지(endpoint · instance · job 등)는 판단에 쓸모가 없다.
const KEPT_LABELS = ['namespace', 'pod', 'container', 'deployment', 'job_name', 'resource', 'reason', 'severity']
const LABEL_CHARS = 200


const keyOf = (slug: string, alertname: string) => `${slug}\u0000${alertname}`
const clip = (s: string) => redactString(s).slice(0, LABEL_CHARS)

/**
 * 스파이크 감지(docs/design/incidents.md). 20초마다 Prometheus 경고를 읽어 학생 프로젝트(`proj-<slug>`)마다 운영 알림을 열고 닫는다.
 * 재시작 반복은 진행 중인 배포가 없으면 바로 멈춘다. 그 밖의 경고는 AI가 판단하고 운영자가 정한다. 노드 경고는 운영자 Discord로만 한 번 보낸다.
 * 확인은 하나씩 차례로 돈다(DeployQueue와 같은 방식). AI 판단(최대 90초)은 확인을 막지 않게 따로 돈다.
 */
@Injectable()
export class AlertWatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AlertWatcher.name)
  private readonly enabled: boolean
  private chain: Promise<void> = Promise.resolve()
  private timer: NodeJS.Timeout | undefined
  private readonly judging = new Set<Promise<void>>()
  // 지금 처리(자동 중지 · AI 판단 · 알림) 중인 알림 id. 같은 알림을 두 번 처리하지 않는다.
  private readonly inFlight = new Set<string>()
  // 지금 울리는 노드 경고. 새로 울릴 때만 보내고, 꺼졌다가 다시 울리면 다시 보낸다(서버가 다시 뜨면 한 번 더 간다).
  private nodeAlerts = new Set<string>()

  constructor(
    config: ConfigService<Env, true>,
    private readonly reader: ClusterReader,
    private readonly scaler: DeploymentScaler,
    private readonly store: IncidentsStore,
    private readonly deploys: DeploysStore,
    private readonly judge: IncidentJudge,
    private readonly discord: DiscordNotifier,
  ) {
    this.enabled = config.get('K8S_API_URL', { infer: true }) !== undefined
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return
    this.timer = setInterval(() => this.kick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    clearInterval(this.timer)
  }

  kick(): void {
    this.chain = this.chain.then(() => this.check()).catch((err: unknown) => this.logger.error(`alert check stopped: ${err instanceof Error ? err.name : 'error'}`))
  }

  /** 확인과 그 뒤 AI 판단이 모두 끝날 때까지(시험용). */
  async idle(): Promise<void> {
    await this.chain
    await Promise.all(this.judging)
  }

  private async check(): Promise<void> {
    let alerts: AlertInfo[]
    try {
      alerts = await this.reader.alerts()
    } catch (err) {
      // 리더가 잠깐 안 보이면 다음 확인에서 다시 본다. 열린 알림은 그대로 둔다(경고가 사라진 것과 구분할 수 없다).
      this.logger.warn(`alerts not read: ${err instanceof ClusterError ? err.kind : 'error'}`)
      return
    }
    const firing = alerts.filter((a) => a.state === 'firing' && a.labels.alertname && !IGNORED(a.labels.alertname))
    const projects = new Map<string, { slug: string; alert: AlertInfo }>()
    const nodes = new Map<string, AlertInfo>()
    for (const alert of firing) {
      const slug = /^proj-(.+)$/.exec(alert.labels.namespace ?? '')?.[1]
      if (slug !== undefined && SLUG.test(slug)) {
        const key = keyOf(slug, alert.labels.alertname)
        if (!projects.has(key)) projects.set(key, { slug, alert })
      } else if (alert.labels.alertname.startsWith('Node')) {
        nodes.set(`${alert.labels.alertname}/${alert.labels.instance ?? ''}`, alert)
      }
    }

    // 노드 경고는 DB를 쓰지 않으므로 DB가 안 보여도 보낸다.
    await Promise.all(
      [...nodes]
        .filter(([key]) => !this.nodeAlerts.has(key))
        .map(([, alert]) => this.discord.toOperator(`[노드] ${alert.labels.alertname} ${alert.labels.instance ?? ''}\n${clip(alert.summary)}`)),
    )
    this.nodeAlerts = new Set(nodes.keys())

    const open = await this.store.unresolved()
    const openKeys = new Set(open.map((i) => keyOf(i.slug, i.alertname)))
    // 처리하다 멈춘 알림(저장 뒤 실패 · 서버 재시작): 아직 울리고, 정할 차례이고, AI 판단도 없으면 다시 처리한다.
    const unfinished = open.filter((i) => projects.has(keyOf(i.slug, i.alertname)) && i.action === 'pending' && i.ai.status === 'pending')
    // 프로젝트마다 따로라 함께 돈다(한 확인이 20초를 넘지 않게).
    await Promise.all([
      ...open.filter((i) => !projects.has(keyOf(i.slug, i.alertname))).map((i) => this.store.resolve(i.id)),
      ...[...projects].filter(([key]) => !openKeys.has(key)).map(([, { slug, alert }]) => this.opened(slug, alert)),
    ])
    for (const incident of unfinished) this.process(incident)
  }

  private async opened(slug: string, alert: AlertInfo): Promise<void> {
    const labels = Object.fromEntries(KEPT_LABELS.flatMap((k) => (alert.labels[k] ? [[k, clip(alert.labels[k])]] : [])))
    const incident = await this.store.insert({
      slug,
      alertname: alert.labels.alertname,
      labels,
      summary: clip(alert.summary),
      fired_at: alert.activeAt ?? new Date().toISOString(),
      action: 'pending',
      ai: emptyAi('pending'),
    })
    if (!incident) return
    this.logger.log(`incident opened: ${slug} ${incident.alertname}`)
    this.process(incident)
  }

  /** 자동 중지나 AI 판단, 그리고 알림. 확인을 막지 않게 따로 돈다. 실패하면 다음 확인이 다시 처리한다. */
  private process(incident: IncidentRow): void {
    if (this.inFlight.has(incident.id)) return
    this.inFlight.add(incident.id)
    const run = (async () => {
      if (incident.alertname === AUTO_STOP && (await this.autoStop(incident))) return
      await this.judgeAndNotify(incident)
    })()
      .catch((err: unknown) => this.logger.error(`incident not processed: ${err instanceof Error ? err.name : 'error'}`))
      .finally(() => {
        this.inFlight.delete(incident.id)
        this.judging.delete(run)
      })
    this.judging.add(run)
  }

  /**
   * 진행 중인 배포가 없으면 프로젝트의 Deployment를 모두 0으로 내린다. 멈췄으면 true.
   * 배포 중의 재시작 반복은 파이프라인 확인(verify)과 AI 에이전트가 다룬다. 그때는 멈추지 않고 AI 판단으로 넘긴다.
   */
  private async autoStop(incident: IncidentRow): Promise<boolean> {
    if (await this.deploys.findActiveRun(incident.slug)) return false
    const result = await stopProject(this.reader, this.scaler, incident.slug)
    // 읽지 못했거나 하나도 못 내렸으면 AI 판단으로 넘긴다. 일부만 내렸으면 그대로 두어(pending) 다음 확인이 나머지를 다시 내린다.
    if (result === 'none') return false
    if (result === 'some') return true
    const stopped = await this.store.update(incident.id, { action: 'auto_stopped', ai: emptyAi('skipped'), decided_by: 'rule', decided_at: new Date().toISOString() }, 'pending')
    if (!stopped) return true
    this.logger.log(`incident auto-stopped: ${incident.slug}`)
    await this.notify(stopped)
    return true
  }

  private async judgeAndNotify(incident: IncidentRow): Promise<void> {
    const ai = await this.judge.judge(incident)
    // 아직 판단 전인 것만 채운다(다른 처리가 먼저 끝냈으면 알림을 다시 보내지 않는다).
    const judged = await this.store.update(incident.id, { ai }, undefined, 'pending')
    if (judged) await this.notify(judged)
  }

  private async notify(incident: IncidentRow): Promise<void> {
    const student = async () => {
      const owner = await this.deploys.findSlugOwner(incident.slug).catch(() => undefined)
      await this.discord.toStudent(owner ? await this.store.webhook(owner.user_id).catch(() => null) : null, studentMessage(incident))
    }
    await Promise.all([this.discord.toOperator(operatorMessage(incident)), student()])
  }
}

/**
 * 프로젝트의 Deployment를 모두 replicas 0으로. `all`: 모두 내렸거나 내릴 것이 없다. `some`: 일부만 내렸다. `none`: 목록을 못 읽었거나 하나도 못 내렸다.
 */
export async function stopProject(reader: ClusterReader, scaler: DeploymentScaler, slug: string): Promise<'all' | 'some' | 'none'> {
  const names = (await reader.deployments(slug).catch(() => null))?.map((d) => d.name)
  if (!names) return 'none'
  const results = await Promise.allSettled(names.map((name) => scaler.scaleToZero(slug, name)))
  const done = results.filter((r) => r.status === 'fulfilled').length
  return done === names.length ? 'all' : done === 0 ? 'none' : 'some'
}
