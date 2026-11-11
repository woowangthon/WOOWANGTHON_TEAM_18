import { Injectable, Logger } from '@nestjs/common'
import { isRecord } from '../common/is-record.js'
import { redact, redactString } from '../common/redact.js'
import { DeploysStore } from '../deploys/deploys.store.js'
import { ClusterReader } from '../k8s/cluster-reader.js'
import { type BudgetCode, ToolBudget } from './budget.js'
import { RepoReader, repoPath } from './repo-reader.js'
import { checkResult } from './result.js'
import type { GatewayTicket } from './tickets.js'

// MCP 게이트웨이의 도구(api.md "MCP 게이트웨이 — 도구"). 인자 · 결과 모양은 거기 고정돼 있다.
// F11은 파이프라인 없이 되는 도구만 연다: 관찰(get_target_status · read_pod_logs · read_repo)과 submit_result.
// 실행 도구(run_*) · 대상 슬롯 운영 · read_build_logs는 파이프라인 시험 실행이 생기는 F11b에서 연다.
// 목록에 없는 도구는 에이전트가 부를 수 없다.

export type RejectCode = BudgetCode | 'INVALID_ARGUMENT' | 'INVALID_RESULT' | 'TICKET_CLOSED'

export type ToolAnswer = { ok: true; content: Record<string, unknown> } | { ok: false; code: RejectCode; message: string }

export interface ToolDef {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false }
}

const DEFAULT_LINES = 100
const MAX_LINES = 200

export const TOOLS: ToolDef[] = [
  {
    name: 'get_target_status',
    description: '대상 슬롯의 Pod · 이벤트 · rollout 상태를 지금 시점으로 읽는다(k3s 원본, managedFields 제외).',
    inputSchema: { type: 'object', properties: { service: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'read_pod_logs',
    description: '대상 슬롯 Pod의 로그. previous면 직전 컨테이너의 로그.',
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string' },
        lines: { type: 'integer', minimum: 1, maximum: MAX_LINES },
        previous: { type: 'boolean' },
      },
      required: ['service'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_repo',
    description: '티켓의 commitSha 시점 레포 파일 · 폴더 목록. path는 레포 안 상대 경로이고 `.`은 루트다.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, source: { type: 'object' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'submit_result',
    description: '해결 결과 제출(docs/design/AIagent.md §6). 이 호출 뒤 게이트웨이 토큰은 무효다.',
    inputSchema: { type: 'object', properties: { result: { type: 'object' } }, required: ['result'], additionalProperties: false },
  },
]

const reject = (code: RejectCode, message: string): ToolAnswer => ({ ok: false, code, message })

/** 인자가 도구의 모양인지. 맞지 않으면 이유. */
function argProblem(def: ToolDef, args: Record<string, unknown>): string | null {
  const { properties, required = [] } = def.inputSchema
  const unknown = Object.keys(args).find((k) => !(k in properties))
  if (unknown) return `unknown argument ${unknown}`
  const missing = required.find((k) => args[k] === undefined)
  if (missing) return `missing argument ${missing}`
  for (const [k, v] of Object.entries(args)) {
    const want = (properties[k] as { type: string }).type
    const ok =
      want === 'string' ? typeof v === 'string' : want === 'boolean' ? typeof v === 'boolean' : want === 'integer' ? Number.isInteger(v) : isRecord(v)
    if (!ok) return `argument ${k} must be ${want === 'object' ? 'an object' : `a ${want}`}`
  }
  return null
}

/** 로그 글을 줄로. 마지막 빈 줄은 뺀다. */
const lines = (text: string) => text.split('\n').filter((line, i, all) => !(i === all.length - 1 && line === ''))

@Injectable()
export class GatewayTools {
  private readonly logger = new Logger(GatewayTools.name)
  readonly budget = new ToolBudget()

  constructor(
    private readonly store: DeploysStore,
    private readonly cluster: ClusterReader,
    private readonly repo: RepoReader,
  ) {}

  async call(ticket: GatewayTicket, name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
    const def = TOOLS.find((t) => t.name === name)
    if (!def) return reject('INVALID_ARGUMENT', `unknown tool ${name}`)
    const wrong = argProblem(def, args)
    if (wrong) return reject('INVALID_ARGUMENT', wrong)
    if (typeof args.service === 'string' && !ticket.services.includes(args.service)) {
      return reject('INVALID_ARGUMENT', `unknown service ${args.service}; services: ${ticket.services.join(', ')}`)
    }
    // 횟수 · 시간 제한 뒤에도 결과는 낼 수 있어야 하므로 submit_result는 세지 않는다.
    if (name !== 'submit_result') {
      const limited = this.budget.take(ticket.ticketId, name, args)
      if (limited) return reject(limited, limitMessage[limited])
    }
    switch (name) {
      case 'get_target_status':
        return this.targetStatus(ticket, args.service as string | undefined)
      case 'read_pod_logs':
        return this.podLogs(ticket, args.service as string, (args.lines as number | undefined) ?? DEFAULT_LINES, args.previous === true)
      case 'read_repo':
        return this.readRepo(ticket, args.path as string, args.source)
      default:
        return this.submit(ticket, args.result)
    }
  }

  private selector(ticket: GatewayTicket, service?: string) {
    return service ? `app=${service},slot=${ticket.targetSlot}` : `slot=${ticket.targetSlot}`
  }

  private async targetStatus(ticket: GatewayTicket, service: string | undefined): Promise<ToolAnswer> {
    const selector = this.selector(ticket, service)
    const [pods, deployments, events] = await Promise.all([
      this.cluster.rawObjects(ticket.slug, 'pods', selector),
      this.cluster.rawObjects(ticket.slug, 'deployments', selector),
      this.cluster.rawObjects(ticket.slug, 'events'),
    ])
    // 이벤트에는 slot 라벨이 없다. 대상 슬롯의 Pod · Deployment(와 그 ReplicaSet)를 가리키는 것만 남긴다.
    const names = [...pods, ...deployments].map((o) => String((o.metadata as { name?: unknown } | undefined)?.name ?? ''))
    const ours = events.filter((e) => {
      const target = String((e.involvedObject as { name?: unknown } | undefined)?.name ?? '')
      return names.some((n) => n !== '' && (target === n || target.startsWith(`${n}-`)))
    })
    const rollouts = deployments.map((d) => {
      const labels = ((d.metadata as { labels?: Record<string, string> } | undefined)?.labels ?? {}) as Record<string, string>
      const status = (d.status ?? {}) as Record<string, unknown>
      return { service: labels.app ?? null, ready: status.readyReplicas ?? 0, updated: status.updatedReplicas ?? 0, available: status.availableReplicas ?? 0 }
    })
    return { ok: true, content: redact({ pods, events: ours, rollouts }) as Record<string, unknown> }
  }

  private async podLogs(ticket: GatewayTicket, service: string, count: number, previous: boolean): Promise<ToolAnswer> {
    const pods = await this.cluster.rawObjects(ticket.slug, 'pods', this.selector(ticket, service))
    // 가장 최근에 만든 Pod(롤아웃 중이면 새 Pod).
    const newest = pods
      .map((p) => p.metadata as { name?: string; creationTimestamp?: string })
      .sort((a, b) => String(b.creationTimestamp ?? '').localeCompare(String(a.creationTimestamp ?? '')))[0]
    if (!newest?.name) return { ok: true, content: { lines: [] } }
    const text = await this.cluster.logs(ticket.slug, newest.name, { container: service, tailLines: count, previous })
    return { ok: true, content: { lines: lines(text).slice(-count).map(redactString) } }
  }

  private async readRepo(ticket: GatewayTicket, path: string, source: unknown): Promise<ToolAnswer> {
    // source는 edit_repo_file이 돌려준 봇 fork 커밋만 받는다. 그 도구는 아직 없다(F13).
    if (source !== undefined) return reject('INVALID_ARGUMENT', 'source is not available yet: there is no edit_repo_file tool')
    const clean = repoPath(path)
    if (clean === null) return reject('INVALID_ARGUMENT', `path must be relative to the repository root, got ${JSON.stringify(path)}`)
    const entry = await this.repo.read(ticket.repo, ticket.commitSha, clean)
    if (entry === null) return reject('INVALID_ARGUMENT', `no such path at ${ticket.commitSha.slice(0, 7)}: ${path}`)
    return { ok: true, content: entry.type === 'file' ? { ...entry, content: redactString(entry.content) } : entry }
  }

  private async submit(ticket: GatewayTicket, value: unknown): Promise<ToolAnswer> {
    const checked = checkResult(value, ticket)
    if (!checked.ok) return reject('INVALID_RESULT', checked.message)
    const { result } = checked
    // fixing인 동안만 바꾼다. 그 사이 끝났으면(시간 초과 등) 토큰도 끝난 것이다.
    const patch =
      result.status === 'gave_up'
        ? { status: 'failed' as const, failure: { code: 'AGENT_GAVE_UP', stage: ticket.failure?.stage ?? 'build', service: ticket.failure?.service ?? null } }
        : // pr_opened(머지 대기)도 needs_user(학생 조치 대기)도 학생을 기다린다.
          { status: 'needs_user' as const }
    const applied = await this.store.updateRun(ticket.deployId, { status: 'fixing' }, { ...patch, gateway_token_hash: null })
    this.budget.forget(ticket.ticketId)
    if (!applied) return reject('TICKET_CLOSED', 'the ticket is no longer open')
    this.logger.log(`ticket ${ticket.ticketId} result ${result.status}`)
    return { ok: true, content: { accepted: true } }
  }
}

const limitMessage: Record<BudgetCode, string> = {
  TOOL_LIMIT: 'this ticket used all its tool calls',
  TIME_LIMIT: 'this ticket used its working time',
  REPEATED_CALL: 'the same tool with the same arguments was called twice in a row already',
}
