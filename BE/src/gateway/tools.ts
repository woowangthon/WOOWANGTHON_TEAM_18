import { Injectable, Logger } from '@nestjs/common'
import { isRecord } from '../common/is-record.js'
import { redact, redactString } from '../common/redact.js'
import { DeploysStore } from '../deploys/deploys.store.js'
import { ClusterReader } from '../k8s/cluster-reader.js'
import type { Spec } from '../deploys/deploy-input.js'
import { type BudgetCode, ToolBudget, WORK_MS } from './budget.js'
import { RepoReader, repoPath } from './repo-reader.js'
import { checkResult, storedResult } from './result.js'
import { applySpecPatch } from './spec-patch.js'
import type { GatewayTicket } from './tickets.js'
import { GatewayTrials, TRIAL_WAIT_MS, type TrialFailure, type TrialTool } from './trials.js'

// MCP 게이트웨이의 도구(api.md "MCP 게이트웨이 — 도구"). 인자 · 결과 모양은 거기 고정돼 있다.
// F11: 관찰(get_target_status · read_pod_logs · read_repo)과 submit_result. F11b-1: 시험 실행 run_render · run_deploy · run_verify
// (api.md "파이프라인 ↔ 플랫폼 서버" 4번). run_build는 B3, 대상 슬롯 운영 · read_build_logs는 그 뒤에 연다.
// 목록에 없는 도구는 에이전트가 부를 수 없다.

export type RejectCode = BudgetCode | 'INVALID_ARGUMENT' | 'INVALID_RESULT' | 'TICKET_CLOSED' | 'PATCH_FORBIDDEN' | 'INVALID_SPEC' | 'LIVE_SLOT_PROTECTED'

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
    name: 'run_render',
    description: 'Render + k3s server-side apply dry-run을 대상 슬롯 입력으로 시험한다(클러스터에 적용하지 않는다). specPatch는 그 시험에만 적용하는 JSON Patch다(runtime만).',
    inputSchema: { type: 'object', properties: { specPatch: { type: 'array' } }, additionalProperties: false },
  },
  {
    name: 'run_deploy',
    description: '대상 슬롯에 Prepare(live 슬롯 보호, 슬롯 비우기) → Render → Apply → Ready 대기를 시험한다. 최대 30분 기다린다. specPatch는 그 시험에만 적용한다(runtime만).',
    inputSchema: { type: 'object', properties: { specPatch: { type: 'array' }, source: { type: 'object' } }, additionalProperties: false },
  },
  {
    name: 'run_verify',
    description: '대상 슬롯을 test Ingress로 동작 확인한다. 이 티켓에서 마지막으로 성공한 run_deploy의 입력으로 확인한다.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
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
      want === 'string'
        ? typeof v === 'string'
        : want === 'boolean'
          ? typeof v === 'boolean'
          : want === 'integer'
            ? Number.isInteger(v)
            : want === 'array'
              ? Array.isArray(v)
              : isRecord(v)
    if (!ok) return `argument ${k} must be ${want === 'object' ? 'an object' : want === 'array' ? 'an array' : `a ${want}`}`
    const { minimum, maximum } = properties[k] as { minimum?: number; maximum?: number }
    if (typeof v === 'number' && ((minimum !== undefined && v < minimum) || (maximum !== undefined && v > maximum))) {
      return `argument ${k} must be from ${minimum ?? '-'} to ${maximum ?? '-'}`
    }
  }
  return null
}

/** 로그 글을 줄로. 마지막 빈 줄은 뺀다. */
const nameOf = (v: unknown): string => (isRecord(v) && typeof v.name === 'string' ? v.name : '')

const lines = (text: string) => text.split('\n').filter((line, i, all) => !(i === all.length - 1 && line === ''))

@Injectable()
export class GatewayTools {
  private readonly logger = new Logger(GatewayTools.name)
  readonly budget = new ToolBudget()
  /** 시험을 부른 채 결과를 기다리는 티켓. 티켓마다 한 번에 하나(검사와 표시 사이에 await가 없게 여기서 센다). */
  private readonly trialing = new Set<string>()

  constructor(
    private readonly store: DeploysStore,
    private readonly cluster: ClusterReader,
    private readonly repo: RepoReader,
    private readonly trials: GatewayTrials,
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
      const limited = this.budget.take(ticket.ticketId, name, args, ticket.expiresAt - WORK_MS)
      if (limited) return reject(limited, limitMessage[limited])
    }
    switch (name) {
      case 'get_target_status':
        return this.targetStatus(ticket, args.service as string | undefined)
      case 'read_pod_logs':
        return this.podLogs(ticket, args.service as string, (args.lines as number | undefined) ?? DEFAULT_LINES, args.previous === true)
      case 'read_repo':
        return this.readRepo(ticket, args.path as string, args.source)
      case 'run_render':
      case 'run_deploy':
      case 'run_verify':
        return this.runTrial(ticket, name, args)
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
    const names = [...pods, ...deployments].map((o) => nameOf(o.metadata))
    const ours = events.filter((e) => {
      const target = nameOf(e.involvedObject)
      return names.some((n) => n !== '' && (target === n || target.startsWith(`${n}-`)))
    })
    const rollouts = deployments.map((d) => {
      const labels = (d.metadata as { labels?: Record<string, string> } | undefined)?.labels ?? {}
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

  /** 시험 입력: 실행 기록의 입력에서 서비스를 모두 reuse + 이미지 digest로(이번 실행에서 빌드한 이미지, 원래 reuse 이미지). 이미지가 없으면 이유. */
  private async baseInput(ticket: GatewayTicket): Promise<Record<string, unknown> | string> {
    const run = await this.store.findRun(ticket.deployId)
    if (!run) return 'the deploy run is gone'
    const input = structuredClone(run.input)
    const services = (input.deploy_condition as { services: Record<string, { buildInputHash: string; build: string; image: string | null }> }).services
    for (const [name, c] of Object.entries(services)) {
      const image = c.build === 'reuse' ? c.image : (run.images?.[name] ?? null)
      if (!image) return `service ${name} has no image yet (the build did not pass); build tickets cannot be tried until run_build opens`
      services[name] = { buildInputHash: c.buildInputHash, build: 'reuse', image }
    }
    return input
  }

  private async runTrial(ticket: GatewayTicket, tool: TrialTool, args: Record<string, unknown>): Promise<ToolAnswer> {
    // source는 edit_repo_file이 돌려준 봇 fork 커밋만 받는다. 그 도구는 아직 없다(F13).
    if (args.source !== undefined) return reject('INVALID_ARGUMENT', 'source is not available yet: there is no edit_repo_file tool')
    if (this.trialing.has(ticket.ticketId)) return reject('INVALID_ARGUMENT', 'another trial of this ticket is still running; wait for its result')
    this.trialing.add(ticket.ticketId)
    try {
      return await this.trial(ticket, tool, args)
    } finally {
      this.trialing.delete(ticket.ticketId)
    }
  }

  private async trial(ticket: GatewayTicket, tool: TrialTool, args: Record<string, unknown>): Promise<ToolAnswer> {
    const base = await this.baseInput(ticket)
    if (typeof base === 'string') return reject('INVALID_ARGUMENT', base)
    let input = base
    if (tool === 'run_verify') input = this.trials.lastDeployInput(ticket.ticketId) ?? base
    else if (args.specPatch !== undefined) {
      const live = await this.store.findLastSucceededRun(ticket.slug)
      const patched = applySpecPatch(base, args.specPatch, live ? ((live.input as { spec: Spec }).spec ?? null) : null)
      if (!patched.ok) return reject(patched.code, patched.fields ? `${patched.message}: ${JSON.stringify(patched.fields)}` : patched.message)
      input = patched.input
    }

    // 기다리는 동안 같은 티켓의 다른 호출이 TICKET_CLOSED를 받지 않게 토큰 만료를 먼저 늘리고, 끝나면 다시 쓴다(updated_at도 함께 바뀐다).
    const cap = this.budget.waitCap(ticket.ticketId, TRIAL_WAIT_MS)
    await this.setExpiry(ticket, this.budget.expiryAtWaitStart(ticket.ticketId, cap))
    const started = Date.now()
    const outcome = await this.trials.run(ticket, tool, input, cap)
    const expiry = this.budget.endWait(ticket.ticketId, Date.now() - started)
    if (expiry !== null) await this.setExpiry(ticket, expiry)

    if ('failure' in outcome) return { ok: true, content: emptyResult(tool, outcome.failure) }
    const failure = outcome.result.failure as TrialFailure | null
    if (failure?.code === 'LIVE_SLOT_PROTECTED') return reject('LIVE_SLOT_PROTECTED', failure.message)
    // 파이프라인이 읽은 k3s 원본 · 로그는 외부(AI 서버 · 추론 API)로 나가므로 가린다.
    return { ok: true, content: redact(outcome.result) as Record<string, unknown> }
  }

  private async setExpiry(ticket: GatewayTicket, at: number): Promise<void> {
    await this.store.updateRun(ticket.deployId, { status: 'fixing' }, { gateway_expires_at: new Date(at).toISOString() })
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
    // 학생에게 보일 칸만 남긴다(도구 호출 원본 · 로그는 버린다). 외부에서 온 글이라 한 번 더 가린다.
    const agentResult = redact(storedResult(result)) as Record<string, unknown>
    const applied = await this.store.updateRun(ticket.deployId, { status: 'fixing' }, { ...patch, agent_result: agentResult, gateway_token_hash: null })
    this.budget.forget(ticket.ticketId)
    await this.trials.endTicket(ticket.ticketId)
    if (!applied) return reject('TICKET_CLOSED', 'the ticket is no longer open')
    this.logger.log(`ticket ${ticket.ticketId} result ${result.status}`)
    return { ok: true, content: { accepted: true } }
  }
}

/** 결과 없이 끝난 시험(실행 실패 · 대기 초과 · 이전 시험이 안 끝남)의 도구 결과. */
function emptyResult(tool: TrialTool, failure: TrialFailure): Record<string, unknown> {
  const fields = tool === 'run_render' ? { status: null } : tool === 'run_deploy' ? { services: [], pods: [], events: [] } : { ready: [], requests: [] }
  return { ok: false, ...fields, failure }
}

const limitMessage: Record<BudgetCode, string> = {
  TOOL_LIMIT: 'this ticket used all its tool calls',
  TIME_LIMIT: 'this ticket used its working time (15 minutes without trial waits, 60 minutes in all)',
  REPEATED_CALL: 'the same tool with the same arguments was called twice in a row already',
}
