import { isDeepStrictEqual } from 'node:util'
import { HttpException, Injectable, Logger } from '@nestjs/common'
import { isRecord } from '../common/is-record.js'
import { redact, redactString } from '../common/redact.js'
import { AgentClient } from '../deploys/agent.client.js'
import { AgentProgress } from '../deploys/agent-progress.js'
import type { ServiceConditions } from '../deploys/deploy-condition.js'
import { DeployConditionService } from '../deploys/deploy-condition.service.js'
import { DeployQueue } from '../deploys/deploy-queue.js'
import { ticketCount } from '../deploys/deploy-run.js'
import { type DeployRunRow, DeploysStore } from '../deploys/deploys.store.js'
import { SlotScaleDown } from '../deploys/slot-scale-down.js'
import { ClusterReader, newestPod } from '../k8s/cluster-reader.js'
import type { Issue, Spec } from '../deploys/deploy-input.js'
import { type BudgetCode, TOTAL_CALLS, ToolBudget } from './budget.js'
import { RepoEdits, type SourceRef } from './repo-edits.js'
import { RepoReader, repoPath } from './repo-reader.js'
import { type AgentResult, checkResult, storedResult } from './result.js'
import { applySpecPatch, livePathProblem } from './spec-patch.js'
import type { GatewayTicket } from './tickets.js'
import { GatewayTrials, TRIAL_WAIT_MS, type TrialFailure, type TrialTool } from './trials.js'

// MCP 게이트웨이의 도구(api.md "MCP 게이트웨이 — 도구"). 인자 · 결과 모양은 거기 고정돼 있다.
// F11: 관찰(get_target_status · read_pod_logs · read_repo)과 submit_result. F11b: 시험 실행 run_build · run_render · run_deploy · run_verify
// (api.md "파이프라인 ↔ 플랫폼 서버" 4번)와 verified 뒤 다시 실행(5번). F13: 레포 수정 edit_repo_file · open_pr(봇 fork, repo-edits.ts).
// 대상 슬롯 운영 · read_build_logs는 그 뒤에 연다.
// 목록에 없는 도구는 에이전트가 부를 수 없다.

export type RejectCode =
  | BudgetCode
  | 'INVALID_ARGUMENT'
  | 'INVALID_RESULT'
  | 'TICKET_CLOSED'
  | 'PATCH_FORBIDDEN'
  | 'INVALID_SPEC'
  | 'OVERRIDE_LIMIT'
  | 'LIVE_SLOT_PROTECTED'
  | 'EDIT_FORBIDDEN'
  | 'NOT_VERIFIED'
  | 'BOT_UNAVAILABLE'

export type ToolAnswer = { ok: true; content: Record<string, unknown> } | { ok: false; code: RejectCode; message: string; fields?: Issue[] }

export interface ToolDef {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false }
}

const DEFAULT_LINES = 100
const MAX_LINES = 200

// run_build의 buildOverrides 상한(AIagent.md §3 표). CodeBuild 프로젝트 기본인 SMALL(무료 티어가 적용되는 크기)만 받는다(2026-11-14 결정: 무료 티어 밖 크기는 쓰지 않는다).
// 이미지는 프로젝트와 같은 이미지만 받는다(privileged 모드에서 docker가 돈다). 다른 OS 이미지로 시험하면 통과해도 실제 빌드와 같다고 볼 수 없다. 시험 빌드 대기 = timeoutMinutes + 5분이 30분 안에 들게 20분까지.
export const OVERRIDE_COMPUTE_TYPES = ['BUILD_GENERAL1_SMALL']
export const OVERRIDE_IMAGES = ['aws/codebuild/amazonlinux-x86_64-standard:5.0']
export const OVERRIDE_MAX_MINUTES = 20

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
    name: 'run_build',
    description:
      '그 서비스 하나를 CodeBuild로 시험 빌드한다(최대 30분 기다린다). specPatch(build · runtime)를 적용한 빌드 값의 해시가 같은 이미지가 이미 있으면 빌드하지 않고 바로 reused: true와 그 이미지로 답한다. 통과한 이미지는 이 티켓의 run_render · run_deploy가 쓴다. buildOverrides는 그 빌드에만 쓰는 CodeBuild 설정이다.',
    inputSchema: {
      type: 'object',
      properties: { service: { type: 'string' }, specPatch: { type: 'array' }, source: { type: 'object' }, buildOverrides: { type: 'object' } },
      required: ['service'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_render',
    description:
      'Render + k3s server-side apply dry-run을 대상 슬롯 입력으로 시험한다(클러스터에 적용하지 않는다). specPatch는 그 시험에만 적용하는 JSON Patch다(build · runtime. 빌드 값을 고친 서비스는 먼저 run_build).',
    inputSchema: { type: 'object', properties: { specPatch: { type: 'array' } }, additionalProperties: false },
  },
  {
    name: 'run_deploy',
    description:
      '대상 슬롯에 Prepare(live 슬롯 보호, 슬롯 비우기) → Render → Apply → Ready 대기를 시험한다. 최대 30분 기다린다. specPatch는 그 시험에만 적용한다(build · runtime. 빌드 값을 고친 서비스는 먼저 run_build).',
    inputSchema: { type: 'object', properties: { specPatch: { type: 'array' }, source: { type: 'object' } }, additionalProperties: false },
  },
  {
    name: 'run_verify',
    description: '대상 슬롯을 test Ingress로 동작 확인한다. 이 티켓에서 마지막으로 성공한 run_deploy의 입력으로 확인한다.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'edit_repo_file',
    description:
      '봇 계정의 fork에 수정 commit을 만든다(학생 레포에는 쓰지 않는다). files의 항목은 { path, content }(파일 전체 내용) 또는 { path, find, replace }(파일에 한 번만 있는 글을 바꾼다)다. 몇 줄만 고칠 때는 find · replace를 쓴다. 한 티켓에서 파일 5개 · 바뀐 줄 50줄(지운 줄 + 넣은 줄)까지이고, .env · .github/ · 비밀값처럼 보이는 줄은 거절한다. 같은 티켓에서 다시 부르면 앞서 고친 것에 이어 쌓는다. 돌려준 source를 run_build · run_deploy · read_repo에 넘겨 확인한다.',
    inputSchema: {
      type: 'object',
      properties: { files: { type: 'array' }, message: { type: 'string' } },
      required: ['files', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'open_pr',
    description:
      '학생 레포에 수정 PR을 연다(봇 계정, 티켓당 1개). 같은 source로 run_deploy와 run_verify를 통과한 뒤에만 열린다. 학생 레포가 PR을 막았으면 url 없이 patch를 돌려준다.',
    inputSchema: {
      type: 'object',
      properties: { source: { type: 'object' }, title: { type: 'string' }, body: { type: 'string' } },
      required: ['source', 'title', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'submit_result',
    description: '해결 결과 제출(docs/design/AIagent.md §6). 이 호출 뒤 게이트웨이 토큰은 무효다.',
    inputSchema: { type: 'object', properties: { result: { type: 'object' } }, required: ['result'], additionalProperties: false },
  },
]

type Rejection = Extract<ToolAnswer, { ok: false }>

const reject = (code: RejectCode, message: string): Rejection => ({ ok: false, code, message })

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
    private readonly queue: DeployQueue,
    private readonly agent: AgentClient,
    private readonly conditions: DeployConditionService,
    private readonly slots: SlotScaleDown,
    private readonly edits: RepoEdits,
    private readonly progress: AgentProgress,
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
      const limited = this.budget.take(ticket.ticketId, name, args, ticket.ticketStart, ticket.expiresAt)
      if (limited) return reject(limited, limitMessage[limited])
      this.progress.record(ticket.ticketId, name, this.budget.calls(ticket.ticketId), TOTAL_CALLS)
    }
    switch (name) {
      case 'get_target_status':
        return this.targetStatus(ticket, args.service as string | undefined)
      case 'read_pod_logs':
        return this.podLogs(ticket, args.service as string, (args.lines as number | undefined) ?? DEFAULT_LINES, args.previous === true)
      case 'read_repo':
        return this.readRepo(ticket, args.path as string, args.source)
      case 'run_build':
      case 'run_render':
      case 'run_deploy':
      case 'run_verify':
        return this.runTrial(ticket, name, args)
      case 'edit_repo_file':
        return this.edits.edit(ticket, args)
      case 'open_pr': {
        const run = await this.store.findRun(ticket.deployId)
        if (!run) return reject('TICKET_CLOSED', 'the deploy run is gone')
        return this.edits.openPr(ticket, args, (source) => this.verifiedWith(ticket, source, run))
      }
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
    const newest = newestPod(await this.cluster.rawObjects(ticket.slug, 'pods', this.selector(ticket, service)))
    if (!newest) return { ok: true, content: { lines: [] } }
    const text = await this.cluster.logs(ticket.slug, newest.name, { container: service, tailLines: count, previous })
    return { ok: true, content: { lines: lines(text).slice(-count).map(redactString) } }
  }

  private async readRepo(ticket: GatewayTicket, path: string, source: unknown): Promise<ToolAnswer> {
    // source는 edit_repo_file이 돌려준 봇 fork 커밋만 받는다(없으면 티켓의 commitSha).
    const from = source === undefined ? { repo: ticket.repo, commitSha: ticket.commitSha } : this.edits.resolve(ticket, source)
    if (typeof from === 'string') return reject('INVALID_ARGUMENT', from)
    const clean = repoPath(path)
    if (clean === null) return reject('INVALID_ARGUMENT', `path must be relative to the repository root, got ${JSON.stringify(path)}`)
    const entry = await this.repo.read(from.repo, from.commitSha, clean)
    if (entry === null) return reject('INVALID_ARGUMENT', `no such path at ${from.commitSha.slice(0, 7)}: ${path}`)
    return { ok: true, content: entry.type === 'file' ? { ...entry, content: redactString(entry.content) } : entry }
  }

  /**
   * 시험 입력(api.md "파이프라인 ↔ 플랫폼 서버" 4번 "입력"): 실행 기록의 입력에 specPatch를 적용하고, 서비스마다 빌드 입력 해시와 이미지를 정한다.
   * 빌드 값이 실행 기록과 같으면 그 해시, 다르면 같은 commit으로 다시 계산한다. 이미지는 실행 기록(원래 reuse 이미지 · 이번 실행에서 빌드한 이미지)
   * → 이 티켓의 시험 이미지 → build_cache 순서로 찾는다(빌드 값을 고친 서비스는 실행 기록의 이미지를 쓰지 않는다).
   * `build`(run_build의 서비스)는 이미지가 없으면 `run`, 나머지는 모두 `reuse` + digest이고, 이미지가 없으면 이유(문자열)를 돌려준다.
   * `source`(edit_repo_file이 만든 봇 fork commit)가 있으면 그 commit의 레포로 입력을 만든다: 입력의 `commitSha` · `spec.project.repo`가 fork로 바뀌어
   * 빌드가 그 commit을 받고, 서비스마다 그 commit에서 해시를 다시 낸다(내용이 같으면 해시도 같아 기존 이미지를 그대로 쓴다).
   */
  private async trialInput(
    ticket: GatewayTicket,
    run: DeployRunRow,
    specPatch: unknown,
    build?: string,
    source?: SourceRef,
  ): Promise<{ ok: true; input: Record<string, unknown>; changed: { service: string; hash: string }[] } | Rejection> {
    const patched = applySpecPatch(run.input, specPatch ?? [])
    if (!patched.ok) return { ok: false, code: patched.code, message: patched.message, ...(patched.fields ? { fields: patched.fields } : {}) }
    const input = patched.input
    const before = (run.input.spec as Spec).services
    const original = (run.input.deploy_condition as { services: ServiceConditions }).services
    const services: ServiceConditions = {}
    const changed: { service: string; hash: string }[] = []
    for (const svc of (input.spec as Spec).services) {
      const c = original[svc.name]
      // name은 고칠 수 없어 실행 기록에 같은 서비스가 있다.
      const sameBuild = isDeepStrictEqual(before.find((b) => b.name === svc.name)?.build, svc.build)
      let hash = c.buildInputHash
      if (!sameBuild || source) {
        try {
          hash = await this.conditions.buildHash(source?.repo ?? ticket.repo, source?.commitSha ?? ticket.commitSha, svc.build)
        } catch (err) {
          // 고친 context · dockerfile이 그 commit에 없다.
          if (err instanceof HttpException && err.getStatus() === 422) return reject('INVALID_ARGUMENT', `${svc.name}: ${(err.getResponse() as { message?: string }).message ?? 'build source not found'}`)
          throw err
        }
      }
      const same = sameBuild && hash === c.buildInputHash
      if (!same) changed.push({ service: svc.name, hash })
      const fromRun = same ? (c.build === 'reuse' ? c.image : (run.images?.[svc.name] ?? null)) : null
      let image = fromRun ?? this.trials.trialImage(ticket.ticketId, svc.name, hash) ?? (await this.store.cachedImage(ticket.slug, svc.name, hash))
      // run_build는 그 서비스만 빌드하고 reuse 서비스는 빌드 단계가 건드리지 않는다. source 하나로 여러 서비스의 해시가 바뀌면 서로 이미지가 없어
      // 아무것도 먼저 빌드하지 못하므로, run_build에서는 다른 서비스 자리를 실행 기록의 이미지로 채운다(이 입력은 배포하지 않는다).
      if (!image && build !== undefined && svc.name !== build) image = c.build === 'reuse' ? c.image : (run.images?.[svc.name] ?? null)
      if (!image && svc.name !== build) {
        return reject('INVALID_ARGUMENT', `service ${svc.name} has no image for these build settings yet; call run_build for it first`)
      }
      services[svc.name] = image ? { buildInputHash: hash, build: 'reuse', image } : { buildInputHash: hash, build: 'run', image: null }
    }
    ;(input.deploy_condition as { services: ServiceConditions }).services = services
    if (source) {
      input.commitSha = source.commitSha
      ;(input.spec as Spec).project.repo = source.repo
    }
    return { ok: true, input, changed }
  }

  private async runTrial(ticket: GatewayTicket, tool: TrialTool, args: Record<string, unknown>): Promise<ToolAnswer> {
    // source는 edit_repo_file이 돌려준 봇 fork 커밋만 받는다.
    const source = args.source === undefined ? undefined : this.edits.resolve(ticket, args.source)
    if (typeof source === 'string') return reject('INVALID_ARGUMENT', source)
    if (this.trialing.has(ticket.ticketId)) return reject('INVALID_ARGUMENT', 'another trial of this ticket is still running; wait for its result')
    this.trialing.add(ticket.ticketId)
    try {
      return await this.trial(ticket, tool, args, source)
    } finally {
      this.trialing.delete(ticket.ticketId)
    }
  }

  private async trial(ticket: GatewayTicket, tool: TrialTool, args: Record<string, unknown>, source?: SourceRef): Promise<ToolAnswer> {
    const run = await this.store.findRun(ticket.deployId)
    if (!run) return reject('TICKET_CLOSED', 'the deploy run is gone')
    let overrides: Record<string, unknown> | null = null
    if (tool === 'run_build' && args.buildOverrides !== undefined) {
      const checked = checkOverrides(args.buildOverrides)
      if ('code' in checked) return checked
      overrides = checked.overrides
    }
    const service = tool === 'run_build' ? (args.service as string) : undefined
    let input: Record<string, unknown>
    if (tool === 'run_verify') {
      const last = this.trials.lastDeployInput(ticket.ticketId)
      if (last) input = last
      else {
        const built = await this.trialInput(ticket, run, undefined)
        if (!built.ok) return built
        input = built.input
      }
    } else {
      const built = await this.trialInput(ticket, run, args.specPatch, service, source)
      if (!built.ok) return built
      input = built.input
      // live 경로 보호는 패치가 없어도 본다: 이 입력을 Apply하면 live가 같이 쓰는 Middleware가 바뀌는지.
      const live = (await this.store.findLastSucceededRun(ticket.slug))?.input.spec as Spec | undefined
      const why = live ? livePathProblem((input as { spec: Spec }).spec, live) : null
      if (why) return reject('PATCH_FORBIDDEN', why)
    }

    let condition: ServiceConditions[string] | undefined
    if (service !== undefined) {
      condition = (input.deploy_condition as { services: ServiceConditions }).services[service]
      // #149: 같은 해시의 이미지가 이미 있다. 빌드할 것이 없으므로 시험을 돌리지 않고 바로 답한다(횟수는 위에서 셌고 대기는 0).
      if (condition.build === 'reuse') {
        this.trials.rememberImage(ticket.ticketId, service, condition.buildInputHash, condition.image!)
        return { ok: true, content: { ok: true, reused: true, build: null, failedPhase: null, logTail: [], image: condition.image, failure: null } }
      }
    }

    // 기다리는 동안 같은 티켓의 다른 호출이 TICKET_CLOSED를 받지 않게 토큰 만료를 먼저 늘리고, 끝나면 다시 쓴다(updated_at도 함께 바뀐다).
    // 늘리지 못했으면(그 사이 티켓이 끝났다) 시험을 실행하지 않는다.
    // 대기 상한은 지금 기준의 절대 마감 시각으로 넘긴다: 만료 갱신 · 실행 요청에 걸린 시간만큼 기다림이 줄어 토큰보다 늦게 기다리지 않는다.
    const cap = this.budget.waitCap(ticket.ticketId, TRIAL_WAIT_MS)
    const deadline = Date.now() + cap
    if (!(await this.setExpiry(ticket, this.budget.startWait(ticket.ticketId, cap)))) {
      this.budget.endWait(ticket.ticketId, 0)
      return reject('TICKET_CLOSED', 'the ticket is no longer open')
    }
    const started = Date.now()
    const outcome = await this.trials.run(ticket, tool, input, deadline, overrides)
    const expiry = this.budget.endWait(ticket.ticketId, Date.now() - started)
    if (expiry !== null) await this.setExpiry(ticket, expiry)

    if ('failure' in outcome) {
      if (outcome.failure.code === 'TICKET_CLOSED') return reject('TICKET_CLOSED', outcome.failure.message)
      return { ok: true, content: emptyResult(tool, outcome.failure) }
    }
    const failure = outcome.result.failure as TrialFailure | null
    if (failure?.code === 'LIVE_SLOT_PROTECTED') return reject('LIVE_SLOT_PROTECTED', redactString(failure.message))
    if (service !== undefined && condition && outcome.result.ok === true) {
      // 통과한 이미지: 이 티켓의 시험 이미지로 기억하고 build_cache에도 쓴다(같은 해시 = 같은 이미지, 3번 build 통과 때와 같은 규칙).
      const image = outcome.result.image as string
      this.trials.rememberImage(ticket.ticketId, service, condition.buildInputHash, image)
      await this.store.cacheImages([{ slug: ticket.slug, service, build_input_hash: condition.buildInputHash, image }])
    }
    // 파이프라인이 읽은 CodeBuild · k3s 원본 · 로그는 외부(AI 서버 · 추론 API)로 나가므로 가린다.
    return { ok: true, content: redact(outcome.result) as Record<string, unknown> }
  }

  /**
   * 이 source로 run_deploy → run_verify를 통과했는가: 통과한 입력의 commit · 레포가 source와 같고, spec이 실행 기록과 같다(레포만 fork로 바뀜).
   * specPatch를 같이 써야만 통과한 source는 PR로 열지 않는다. PR에는 spec 변경이 실리지 않아 학생이 머지해도 같은 실패가 난다.
   */
  private verifiedWith(ticket: GatewayTicket, source: SourceRef, run: DeployRunRow): boolean {
    const input = this.trials.verifiedInput(ticket.ticketId) as { commitSha?: unknown; spec?: Spec } | undefined
    if (input?.commitSha !== source.commitSha || input.spec?.project?.repo !== source.repo) return false
    const original = run.input.spec as Spec
    return isDeepStrictEqual({ ...input.spec, project: { ...input.spec.project, repo: original.project.repo } }, original)
  }

  /** 토큰 만료를 쓴다. 실행 기록이 이미 fixing이 아니면(티켓이 끝났다) false. */
  private setExpiry(ticket: GatewayTicket, at: number): Promise<boolean> {
    return this.store.updateRun(ticket.deployId, { status: 'fixing' }, { gateway_expires_at: new Date(at).toISOString() })
  }

  private async submit(ticket: GatewayTicket, value: unknown): Promise<ToolAnswer> {
    const checked = checkResult(value, ticket)
    if (!checked.ok) return reject('INVALID_RESULT', checked.message)
    const { result } = checked
    const run = await this.store.findRun(ticket.deployId)
    // endTicket이 지우기 전에 읽는다.
    const deployTried = this.trials.attemptedDeploy(ticket.ticketId)
    // 학생에게 보일 칸만 남긴다(도구 호출 원본 · 로그는 버린다). 외부에서 온 글이라 한 번 더 가린다.
    // tickets: 이 실행 기록에서 몇 번째 티켓의 결과인가(실행 기록당 3개, api.md 5번). 학생에게 보이는 칸은 아니다.
    const agentResult: Record<string, unknown> = { ...(redact(storedResult(result)) as Record<string, unknown>), tickets: ticketCount(run) }
    if (result.status === 'pr_opened') {
      // 열지 않은 PR을 열었다고 하지 못하게: open_pr이 이 티켓에 돌려준 주소와 같아야 하고, 파일 · 줄 수는 게이트웨이가 센 값을 쓴다.
      const opened = this.edits.openedPr(ticket.ticketId)
      if (opened === null || result.pr?.url !== opened.url) return reject('INVALID_RESULT', 'pr_opened needs pr.url to be the url open_pr returned in this ticket')
      agentResult.pr = { url: opened.url, files: opened.files, changedLines: opened.changedLines }
    }
    // PR을 열지 못했다(학생 레포가 막음): 확인한 patch를 플랫폼이 학생 안내에 붙인다. 에이전트는 patch 글을 받지도 옮겨 쓰지도 않는다.
    const patchText = result.status === 'needs_user' ? this.edits.patchFor(ticket.ticketId) : null
    if (patchText) {
      const u = agentResult.userRequest as { message: string; secretKeys: string[] }
      agentResult.userRequest = { ...u, message: `${u.message}\n\n${patchText}` }
    }
    if (result.status === 'verified') {
      if (run?.status === 'fixing') return this.submitVerified(ticket, run, result, agentResult)
      this.budget.forget(ticket.ticketId)
      this.progress.forget(ticket.ticketId)
      this.edits.forget(ticket.ticketId)
      await this.trials.endTicket(ticket.ticketId)
      return reject('TICKET_CLOSED', 'the ticket is no longer open')
    }

    // fixing인 동안만 바꾼다. 그 사이 끝났으면(시간 초과 등) 토큰도 끝난 것이다.
    const patch =
      result.status === 'gave_up'
        ? { status: 'failed' as const, failure: { code: 'AGENT_GAVE_UP', stage: ticket.failure?.stage ?? 'build', service: ticket.failure?.service ?? null } }
        : // pr_opened(머지 대기)도 needs_user(학생 조치 대기)도 학생을 기다린다.
          { status: 'needs_user' as const }
    const applied = await this.store.updateRun(ticket.deployId, { status: 'fixing' }, { ...patch, agent_result: agentResult, gateway_token_hash: null })
    this.budget.forget(ticket.ticketId)
      this.progress.forget(ticket.ticketId)
    this.edits.forget(ticket.ticketId)
    await this.trials.endTicket(ticket.ticketId)
    if (!applied) return reject('TICKET_CLOSED', 'the ticket is no longer open')
    // 에이전트가 포기했다: 더 읽을 사람이 없으니 대상 슬롯의 Pod가 계속 재시작하지 않게 내린다.
    if (result.status === 'gave_up' && run) await this.cleanSlot(run, ticket.failure?.stage ?? null, deployTried)
    this.logger.log(`ticket ${ticket.ticketId} result ${result.status}`)
    return { ok: true, content: { accepted: true } }
  }

  /** 포기한 티켓의 대상 슬롯 정리. 이 티켓의 시험이 아직 도는지 확인되지 않으면 그 시험과 겹칠 수 있어 건너뛴다. */
  private async cleanSlot(run: DeployRunRow, stage: string | null, slotTouched: boolean): Promise<void> {
    if (!(await this.trials.settled(run.slug))) {
      this.logger.warn(`failed slot: ${run.slug} not scaled down, an earlier trial could not be confirmed stopped`)
      return
    }
    await this.slots.afterFailure(run, stage, slotTouched)
  }

  /**
   * `verified`(api.md "파이프라인 ↔ 플랫폼 서버" 5번): 이 티켓에서 같은 specPatch로 run_deploy → run_verify를 통과했으면
   * 그 입력을 실행 기록에 저장하고 대기열에 다시 세운다. 차례가 오면 대기열이 student-deploy를 처음부터 다시 실행한다(공개 주소는 그 Switch에서만 바뀐다).
   * running은 대기열만 만든다: 다른 프로젝트가 도는 동안 둘이 함께 돌지 않게 한다(docs/design/deploy-workflow.md §5-1).
   */
  private async submitVerified(ticket: GatewayTicket, run: DeployRunRow, result: AgentResult, agentResult: Record<string, unknown>): Promise<ToolAnswer> {
    const patched = await this.trialInput(ticket, run, result.specPatch)
    if (!patched.ok) return patched.code === 'INVALID_ARGUMENT' ? reject('INVALID_RESULT', patched.message) : patched
    const tried = this.trials.verifiedInput(ticket.ticketId)
    if (!tried || !isDeepStrictEqual(tried, patched.input)) {
      return reject('INVALID_RESULT', 'verified needs a run_deploy with this same specPatch followed by a passing run_verify in this ticket')
    }
    // 빌드 값을 고쳤으면 그 빌드 값으로 이 티켓에서 run_build가 통과(또는 재사용)했어야 한다.
    const unbuilt = patched.changed.find((c) => this.trials.trialImage(ticket.ticketId, c.service, c.hash) === undefined)
    if (unbuilt) return reject('INVALID_RESULT', `verified changes the build of ${unbuilt.service}; it needs a passing run_build of ${unbuilt.service} with the same specPatch in this ticket`)

    // 여기부터 티켓은 끝난다. 기다리는 시험을 취소하고, 같은 프로젝트의 이전 시험이 끝났음을 확인한 뒤에만 줄에 세운다.
    this.budget.forget(ticket.ticketId)
      this.progress.forget(ticket.ticketId)
    this.edits.forget(ticket.ticketId)
    await this.trials.endTicket(ticket.ticketId)
    const stage = ticket.failure?.stage ?? 'build'
    if (!(await this.trials.settled(ticket.slug))) {
      const failure = { code: 'TRIAL_STILL_RUNNING', stage, service: null }
      const applied = await this.store.updateRun(ticket.deployId, { status: 'fixing' }, { status: 'failed', failure, agent_result: agentResult, gateway_token_hash: null })
      if (!applied) return reject('TICKET_CLOSED', 'the ticket is no longer open')
      await this.agent.close(ticket.ticketId, ticket.commitSha, 'stopped')
      this.logger.error(`ticket ${ticket.ticketId} verified but an earlier trial could not be confirmed stopped`)
      return { ok: true, content: { accepted: true } }
    }

    // 고친 입력(모든 서비스 reuse + 이미지 digest)을 실행 기록에 저장한다. 학생이 저장한 deploys.spec은 그대로다.
    // ticket_id는 종료 알림(success · superseded · stopped)을 보낼 때까지 남긴다. 대기열은 ticket_id로 다시 실행을 알아본다.
    // created_at은 그대로라 처음 시작한 시각의 순서로 줄에 선다.
    const applied = await this.store.updateRun(
      ticket.deployId,
      { status: 'fixing' },
      { status: 'queued', stage: 'build', failure: null, input: patched.input, agent_result: agentResult, gateway_token_hash: null },
    )
    if (!applied) return reject('TICKET_CLOSED', 'the ticket is no longer open')
    this.queue.kick()
    this.logger.log(`ticket ${ticket.ticketId} result verified: deploy queued again`)
    return { ok: true, content: { accepted: true } }
  }
}

/** 결과 없이 끝난 시험(실행 실패 · 대기 초과 · 이전 시험이 안 끝남)의 도구 결과. */
function emptyResult(tool: TrialTool, failure: TrialFailure): Record<string, unknown> {
  const fields =
    tool === 'run_build'
      ? { reused: false, build: null, failedPhase: null, logTail: [], image: null }
      : tool === 'run_render'
        ? { status: null }
        : tool === 'run_deploy'
          ? { services: [], pods: [], events: [] }
          : { ready: [], requests: [] }
  return { ok: false, ...fields, failure }
}

/** buildOverrides 검사(AIagent.md §3 표). 모양이 틀리면 INVALID_ARGUMENT, 상한 · 허용 목록 밖이면 OVERRIDE_LIMIT. 맞으면 받은 칸만 담은 새 객체. */
function checkOverrides(value: unknown): { overrides: Record<string, unknown> } | Rejection {
  const o = value as Record<string, unknown>
  const unknown = Object.keys(o).find((k) => !['computeType', 'timeoutMinutes', 'image', 'cache'].includes(k))
  if (unknown) return { ok: false, code: 'INVALID_ARGUMENT', message: `buildOverrides has an unknown key ${unknown}` }
  const out: Record<string, unknown> = {}
  if (o.computeType !== undefined) {
    if (typeof o.computeType !== 'string') return { ok: false, code: 'INVALID_ARGUMENT', message: 'buildOverrides.computeType must be a string' }
    if (!OVERRIDE_COMPUTE_TYPES.includes(o.computeType)) return { ok: false, code: 'OVERRIDE_LIMIT', message: `buildOverrides.computeType must be one of ${OVERRIDE_COMPUTE_TYPES.join(', ')}` }
    out.computeType = o.computeType
  }
  if (o.timeoutMinutes !== undefined) {
    if (!Number.isInteger(o.timeoutMinutes)) return { ok: false, code: 'INVALID_ARGUMENT', message: 'buildOverrides.timeoutMinutes must be an integer' }
    const m = o.timeoutMinutes as number
    if (m < 1 || m > OVERRIDE_MAX_MINUTES) return { ok: false, code: 'OVERRIDE_LIMIT', message: `buildOverrides.timeoutMinutes must be from 1 to ${OVERRIDE_MAX_MINUTES}` }
    out.timeoutMinutes = m
  }
  if (o.image !== undefined) {
    if (typeof o.image !== 'string') return { ok: false, code: 'INVALID_ARGUMENT', message: 'buildOverrides.image must be a string' }
    if (!OVERRIDE_IMAGES.includes(o.image)) return { ok: false, code: 'OVERRIDE_LIMIT', message: `buildOverrides.image must be one of ${OVERRIDE_IMAGES.join(', ')}` }
    out.image = o.image
  }
  if (o.cache !== undefined) {
    if (typeof o.cache !== 'boolean') return { ok: false, code: 'INVALID_ARGUMENT', message: 'buildOverrides.cache must be a boolean' }
    out.cache = o.cache
  }
  return { overrides: out }
}

const limitMessage: Record<BudgetCode, string> = {
  TOOL_LIMIT: 'this ticket used all its tool calls',
  TIME_LIMIT: 'this ticket used its working time (15 minutes without trial waits, 60 minutes in all)',
  REPEATED_CALL: 'the same tool with the same arguments was called twice in a row already',
}
