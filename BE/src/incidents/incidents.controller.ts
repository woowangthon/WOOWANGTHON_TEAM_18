import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Post, Put, ServiceUnavailableException, UseGuards } from '@nestjs/common'
import { AdminGuard } from '../admin/admin.guard.js'
import { CurrentUser } from '../auth/auth.decorators.js'
import type { AuthUser } from '../auth/auth.decorators.js'
import { isRecord } from '../common/is-record.js'
import { parseUuid } from '../common/uuid.js'
import { DISCORD_WEBHOOK } from '../config/env.js'
import { DeploysStore } from '../deploys/deploys.store.js'
import { ClusterReader } from '../k8s/cluster-reader.js'
import { DeploymentScaler } from '../k8s/deployment-scaler.js'
import { stopProject } from './alert-watcher.js'
import { titleOf } from './incident-text.js'
import { type IncidentRow, IncidentsStore } from './incidents.store.js'

const ADMIN_LIMIT = 50
const STUDENT_WINDOW_MS = 24 * 3600_000
const STUDENT_PROJECTS = 50

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
    const rows = await this.store.recent(ADMIN_LIMIT)
    // 정할 차례인 것을 먼저, 그 안에서는 최근 것부터(정렬은 안정적이다).
    return { incidents: [...rows].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a))).map(adminView) }
  }

  @Post(':id/stop')
  @HttpCode(200)
  async stop(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const incident = await this.pending(id)
    if (!(await stopProject(this.reader, this.scaler, incident.slug))) {
      throw new ServiceUnavailableException({ code: 'CLUSTER_UNREACHABLE', message: 'Could not stop the project in the cluster' })
    }
    return this.decide(incident, 'stopped', user)
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
  constructor(
    private readonly store: IncidentsStore,
    private readonly deploys: DeploysStore,
  ) {}

  /** 내 프로젝트의 열린 알림과 최근 24시간에 멈춘 것. */
  @Get('incidents')
  async mine(@CurrentUser() user: AuthUser) {
    const slugs = [...new Set((await this.deploys.listOwned(user.id, STUDENT_PROJECTS)).map((d) => d.slug))]
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
