import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Post, Put, ServiceUnavailableException, UseGuards } from '@nestjs/common'
import { AdminGuard } from '../admin/admin.guard.js'
import { CurrentUser } from '../auth/auth.decorators.js'
import type { AuthUser } from '../auth/auth.decorators.js'
import { isRecord } from '../common/is-record.js'
import { parseUuid } from '../common/uuid.js'
import { DISCORD_WEBHOOK } from '../config/env.js'
import { ClusterReader } from '../k8s/cluster-reader.js'
import { DeploymentScaler } from '../k8s/deployment-scaler.js'
import { stopProject } from './alert-watcher.js'
import { titleOf } from './incident-text.js'
import { type IncidentRow, IncidentsStore } from './incidents.store.js'

const ADMIN_LIMIT = 50
const STUDENT_WINDOW_MS = 24 * 3600_000

const iso = (v: string | null) => (v === null ? null : new Date(v).toISOString())
const isOpen = (i: IncidentRow) => i.resolved_at === null && i.action === 'pending'

/** 계약은 docs/design/api.md "운영 알림". */
function view(i: IncidentRow) {
  return {
    id: i.id,
    slug: i.slug,
    alertname: i.alertname,
    title: titleOf(i.alertname),
    state: i.resolved_at === null ? ('firing' as const) : ('resolved' as const),
    firedAt: iso(i.fired_at),
    resolvedAt: iso(i.resolved_at),
    action: i.action,
    ai: i.ai,
    decidedAt: iso(i.decided_at),
  }
}
const adminView = (i: IncidentRow) => ({ ...view(i), decidedBy: i.decided_by })

const notFound = () => new NotFoundException({ code: 'INCIDENT_NOT_FOUND', message: 'No such incident' })
const closed = () => new ConflictException({ code: 'INCIDENT_CLOSED', message: 'This incident was already decided' })

@UseGuards(AdminGuard)
@Controller('admin/incidents')
export class AdminIncidentsController {
  constructor(
    private readonly store: IncidentsStore,
    private readonly reader: ClusterReader,
    private readonly scaler: DeploymentScaler,
  ) {}

  @Get()
  async list() {
    // 정할 차례인 것은 최근 50개 밖으로 밀려도 빠지지 않게 따로 읽는다.
    const [waiting, recent] = await Promise.all([this.store.waiting(), this.store.recent(ADMIN_LIMIT)])
    const seen = new Set(waiting.map((i) => i.id))
    return { incidents: [...waiting, ...recent.filter((i) => !seen.has(i.id))].map(adminView) }
  }

  @Post(':id/stop')
  @HttpCode(200)
  async stop(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    // 결정을 먼저 잡고(겹친 무시 · 중지는 하나만 통과) 클러스터를 바꾼다.
    const decided = await this.decide(await this.pending(id), 'stopped', user)
    const result = await stopProject(this.reader, this.scaler, decided.incident.slug)
    if (result === 'none') {
      // 아무것도 바뀌지 않았으니 결정을 되돌려 다시 정할 수 있게 한다.
      await this.store.update(decided.incident.id, { action: 'pending', decided_by: null, decided_at: null }, 'stopped')
      throw new ServiceUnavailableException({ code: 'CLUSTER_UNREACHABLE', message: 'Could not stop the project in the cluster' })
    }
    // 프로젝트가 멈췄으니 같은 프로젝트의 다른 대기 중 알림도 같은 결정으로 닫는다(중지를 알림마다 누르지 않게).
    await this.store.closePending(decided.incident.slug, { action: 'stopped', decided_by: decided.incident.decidedBy, decided_at: decided.incident.decidedAt })
    if (result === 'some') {
      // 일부는 이미 내려갔다: 결정(stopped)은 그대로 두고(되돌리면 무시로 바뀔 수 있다), 나머지는 프로젝트 강제 중지로 다시 내린다.
      throw new ServiceUnavailableException({ code: 'STOP_INCOMPLETE', message: 'Some services were stopped, some were not; retry with the project stop' })
    }
    return decided
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  async dismiss(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.decide(await this.pending(id), 'dismissed', user)
  }

  private async pending(id: string): Promise<IncidentRow> {
    const uuid = parseUuid(id)
    const incident = uuid ? await this.store.find(uuid) : null
    if (!incident) throw notFound()
    if (incident.action !== 'pending') throw closed()
    return incident
  }

  private async decide(incident: IncidentRow, action: 'stopped' | 'dismissed', user: AuthUser) {
    const decided = await this.store.update(incident.id, { action, decided_by: user.email, decided_at: new Date().toISOString() }, 'pending')
    if (!decided) throw closed()
    return { incident: adminView(decided) }
  }
}

@Controller()
export class IncidentsController {
  constructor(private readonly store: IncidentsStore) {}

  /** 내 프로젝트의 열린 알림과 최근 24시간에 멈춘 것. */
  @Get('incidents')
  async mine(@CurrentUser() user: AuthUser) {
    const slugs = await this.store.ownedSlugs(user.id)
    const since = new Date(Date.now() - STUDENT_WINDOW_MS).toISOString()
    const rows = await this.store.forSlugs(slugs, since)
    return { incidents: rows.filter((i) => isOpen(i) || i.action === 'auto_stopped' || i.action === 'stopped').map(view) }
  }

  @Get('profile/discord-webhook')
  async webhook(@CurrentUser() user: AuthUser) {
    return hinted(await this.store.webhook(user.id))
  }

  @Put('profile/discord-webhook')
  async setWebhook(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const url = isRecord(body) ? body.url : undefined
    if (url !== null && !(typeof url === 'string' && DISCORD_WEBHOOK.test(url))) {
      throw new BadRequestException({ code: 'INVALID_WEBHOOK', message: 'url must be a Discord webhook URL like https://discord.com/api/webhooks/<id>/<token>, or null' })
    }
    await this.store.setWebhook(user.id, url)
    return hinted(url)
  }
}

/** 주소는 보내기 권한이라 끝 4자만 보인다. */
const hinted = (url: string | null) => ({ set: url !== null, hint: url === null ? null : url.slice(-4) })
