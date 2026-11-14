import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { isRecord } from '../common/is-record.js'
import { redact, redactString } from '../common/redact.js'
import type { Env } from '../config/env.js'
import type { ServiceConditions } from './deploy-condition.js'
import type { Spec } from './deploy-input.js'
import { ENDED_STATUSES, isStage, strOrNull as str, toAgent, toFailure } from './deploy-run.js'
import { DeployEvents } from './deploy-events.js'
import { type DeployRunRow, DeploysStore } from './deploys.store.js'

// 학생용 배포 설명(docs/design/deploy-explain.md, FR-105). 배포가 끝나면 AI 서버에 한 번 묻고 BE 메모리에 둔다.
// 배포 흐름과는 완전히 떨어져 있다: 여기서 무엇이 실패해도 배포 상태 · 대기열 · 티켓 · 알림은 그대로다.

// AI 서버는 추론 모델 한 번에 120초까지 쓴다.
const TIMEOUT_MS = 150_000
// simple: BE 메모리에만 둔다. 서버가 다시 뜨면 비어서 FE는 정적 단계 설명을 보인다. 오래된 것부터 버린다.
const MAX_ENTRIES = 200

// 학생 문제로 난 실패(티켓이 간 실패)의 코드. 그 밖의 코드는 플랫폼 문제라 설명하지 않는다(skipped).
// AGENT_UNAVAILABLE은 AI 서버가 티켓을 받지 못한 실패라 넣지 않는다: 같은 AI 서버에 설명을 물어도 기다리기만 한다.
const STUDENT_CODES = ['BUILD_FAILED', 'DEPLOY_FAILED', 'VERIFY_FAILED', 'AGENT_GAVE_UP']

export interface Explanation {
  summary: string
  steps: { stage: string; did: string; meaning: string }[]
  cause: string | null
  actions: string[]
  terms: { term: string; meaning: string }[]
}

/** 진행 상태 읽기의 `explanation`(api.md). ready일 때만 content가 있다. */
export type ExplanationView = { state: 'pending' | 'failed' | 'skipped'; content: null } | { state: 'ready'; content: Explanation }

/** 실패 티켓에서 화이트리스트로 고른 재료. 이미 비밀값 필터를 거친 티켓에서 고른다. */
export interface FailureMaterial {
  errorMessage: string
  logs: string[]
  pods: string[]
  events: string[]
  renderStatus: string | null
}

const INTERNAL = '[internal]'
// 학생에게 보일 필요가 없는 내부 이름. 노출을 막는 필터이고 판단에는 쓰지 않는다.
const INTERNAL_NAMES: RegExp[] = [
  /\barn:aws[a-z-]*:[^\s"',]+/gi, // AWS ARN
  /\b\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\S*/gi, // ECR 레지스트리
  /\bghcr\.io\/[^\s"',]+/gi, // 이미지 레지스트리 주소
  /\b[a-z0-9.-]+\.(?:svc\.cluster\.local|svc|ts\.net|internal|compute\.amazonaws\.com)\b/gi, // 클러스터 · Tailscale · EC2 내부 호스트
  /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, // IPv4(Tailscale 100.x 포함)
  /\bproj-[a-z0-9-]+\b/g, // 학생 공간(네임스페이스) 이름
  /\b(?:app\.kubernetes\.io|helm\.sh|platform\.[a-z.]+)\/[A-Za-z0-9._-]+(?:=\S+)?/g, // 플랫폼 라벨
]

/** 내부 호스트 · 네임스페이스 · 레지스트리 · IP · ARN을 가린다. */
export function maskInternal(text: string): string {
  return INTERNAL_NAMES.reduce((out, re) => out.replace(re, INTERNAL), text)
}

/** 문자열마다 내부 이름 가림 → 비밀값 필터. 길이 상한도 여기서 맞춘다. */
const clean = (text: string, limit: number) => redactString(maskInternal(text)).slice(0, limit)

const records = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : [])
const rec = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {})

function containerLine(c: Record<string, unknown>): string {
  const state = rec(c.state)
  const last = rec(rec(c.lastState).terminated)
  const now = isRecord(state.waiting) ? `waiting ${str(state.waiting.reason) ?? ''}` : isRecord(state.terminated) ? `terminated ${str(state.terminated.reason) ?? ''} (exit ${String(state.terminated.exitCode)})` : isRecord(state.running) ? 'running' : 'unknown'
  const restarts = typeof c.restartCount === 'number' ? c.restartCount : 0
  const lastExit = str(last.reason) ? ` · last exit ${String(last.exitCode)} (${str(last.reason)})` : ''
  return `${str(c.name) ?? '?'}: ${now.trim()} · restarts ${restarts}${lastExit}`
}

/** 이미 비밀값 필터를 거친 티켓에서 재료를 고른다. Pod spec · metadata · CodeBuild 원본은 넣지 않는다. */
export function materialOf(ticket: Record<string, unknown>): FailureMaterial {
  const k8s = rec(rec(ticket.raw).k8s)
  const pod = rec(k8s.pod)
  const status = rec(pod.status)
  const pods = [...records(status.initContainerStatuses), ...records(status.containerStatuses)].map(containerLine)
  const events = [...new Set(records(k8s.events).map((e) => `${str(e.reason) ?? ''}: ${str(e.message) ?? ''}`))].slice(-10)
  const render = isRecord(k8s.status) ? k8s.status : null
  const causes = render ? records(rec(render.details).causes).map((c) => str(c.message) ?? '').filter(Boolean) : []
  const renderStatus = render ? [`${str(render.reason) ?? ''}: ${str(render.message) ?? ''}`, ...causes].join('\n') : null
  const lines = rec(ticket.logs).lines
  return {
    errorMessage: str(ticket.errorMessage) ?? '',
    logs: Array.isArray(lines) ? lines.filter((x): x is string => typeof x === 'string').slice(-200) : [],
    pods: pods.slice(0, 10),
    events,
    renderStatus,
  }
}

/** AI 서버 `POST /agent/explanations`의 요청 본문을 만든다(api.md). 설명하지 않을 실행이면 null(skipped). */
export function explainRequest(run: DeployRunRow, material: FailureMaterial | undefined, firstDeploy: boolean | undefined): Record<string, unknown> | null {
  const outcome = run.status
  if (outcome !== 'succeeded' && outcome !== 'failed' && outcome !== 'needs_user') return null
  if (outcome !== 'succeeded' && (run.ticket_id === null || !run.failure || !STUDENT_CODES.includes(run.failure.code))) return null
  // 시작 때 검증한 입력이라 모양은 믿는다(deploy-runs.service의 conditionsOf와 같다).
  const input = run.input as { spec: Spec; deploy_condition?: { services?: ServiceConditions } }
  const conditions: Partial<ServiceConditions> = input.deploy_condition?.services ?? {}
  const services = input.spec.services.map((s) => {
    const build = conditions[s.name]?.build
    return {
      name: s.name,
      role: s.role,
      kind: s.runtime.kind,
      port: s.runtime.port,
      ingressPath: s.runtime.ingressPath,
      health: { type: s.runtime.health.type, path: s.runtime.health.path },
      build: build === 'run' || build === 'reuse' ? build : null,
      framework: s.build.framework,
      hasDockerfile: s.build.dockerfile !== null,
      buildCommand: s.build.build === null ? null : clean(s.build.build, 200),
      startCommand: s.build.start === null ? null : clean(s.build.start, 200),
      // env 값과 비밀값 이름은 보내지 않는다.
      envCount: Object.keys(s.runtime.env).length,
    }
  })
  // `secretCount`는 이름에 secret이 들어 있어 마지막 redact가 숫자를 가린다. 필터를 거친 뒤에 개수를 다시 붙인다.
  const secretCounts = input.spec.services.map((s) => s.runtime.secretKeys.length)
  const failure = run.failure && outcome !== 'succeeded' ? toFailure(run.failure) : null
  const agent = run.agent_result ? toAgent(run.agent_result) : null
  const body = {
    deployId: run.deploy_id,
    outcome,
    targetSlot: run.target_slot,
    firstDeploy: firstDeploy ?? null,
    services,
    failure: failure && { code: failure.code, stage: failure.stage, service: failure.service, message: failure.message },
    evidence:
      failure && material
        ? {
            errorMessage: clean(material.errorMessage, 2000),
            logs: material.logs.map((l) => clean(l, 400)),
            pods: material.pods.map((p) => clean(p, 200)),
            events: material.events.map((e) => clean(e, 400)),
            renderStatus: material.renderStatus === null ? null : clean(material.renderStatus, 2000),
          }
        : null,
    agent: agent && {
      status: agent.status.slice(0, 20),
      summary: clean(agent.summary, 2000),
      evidence: agent.evidence
        .map((e) => [e.ref, e.text].filter(Boolean).join(': '))
        .filter(Boolean)
        .slice(0, 10)
        .map((e) => clean(e, 500)),
    },
  }
  // 마지막으로 전체에 비밀값 필터를 한 번 더(이름이 민감한 칸). 내부 이름 가림은 위의 자유 글(로그 · 명령 · 에이전트 글)에만 건다:
  // 서비스 이름 · 경로는 학생이 정한 값이라 `proj-web`처럼 가림 패턴에 걸려도 그대로 보낸다.
  const safe = redact(body) as Record<string, unknown>
  ;(safe.services as Record<string, unknown>[]).forEach((svc, i) => (svc.secretCount = secretCounts[i]))
  return safe
}

const text = (v: unknown, limit: number): string | null => (typeof v === 'string' ? clean(v, limit) : null)

/** AI 서버의 답을 확인하고 자르고 다시 가린다. 모양이 틀리면 null(failed). */
export function parseExplanation(v: unknown): Explanation | null {
  if (!isRecord(v)) return null
  const summary = text(v.summary, 300)
  if (summary === null || !Array.isArray(v.steps) || !Array.isArray(v.actions) || !Array.isArray(v.terms)) return null
  if (v.cause !== null && typeof v.cause !== 'string') return null
  const steps = records(v.steps).flatMap((s) => {
    const did = text(s.did, 300)
    const meaning = text(s.meaning, 300)
    return isStage(s.stage) && did !== null && meaning !== null ? [{ stage: s.stage, did, meaning }] : []
  })
  const terms = records(v.terms).flatMap((t) => {
    const term = text(t.term, 40)
    const meaning = text(t.meaning, 200)
    return term !== null && meaning !== null ? [{ term, meaning }] : []
  })
  const actions = (v.actions as unknown[]).flatMap((a) => (typeof a === 'string' ? [text(a, 200)!] : []))
  return { summary, steps: steps.slice(0, 6), cause: text(v.cause, 300), actions: actions.slice(0, 5), terms: terms.slice(0, 5) }
}

/**
 * 끝난 배포의 설명을 만들어 메모리에 둔다. 플래그(`DEPLOY_EXPLAIN_ENABLED`)가 꺼져 있으면 아무것도 하지 않고 `read`는 늘 null이다.
 * 모든 공개 메서드는 던지지 않는다: 배포 흐름의 호출 지점이 이 모듈의 실패로 바뀌면 안 된다.
 */
@Injectable()
export class DeployExplainer implements OnModuleInit {
  private readonly logger = new Logger(DeployExplainer.name)
  private readonly enabled: boolean
  private readonly url: string | undefined
  private readonly token: string | undefined
  private readonly views = new Map<string, ExplanationView>()
  private readonly materials = new Map<string, FailureMaterial>()
  private readonly firstDeploys = new Map<string, boolean>()

  constructor(
    config: ConfigService<Env, true>,
    private readonly events: DeployEvents,
    private readonly store: DeploysStore,
  ) {
    this.enabled = config.get('DEPLOY_EXPLAIN_ENABLED', { infer: true })
    this.url = config.get('AI_SERVER_URL', { infer: true })
    this.token = config.get('AGENT_API_TOKEN', { infer: true })
  }

  onModuleInit(): void {
    if (!this.enabled) return
    this.events.onEnded((deployId) => {
      // 끝난 직후 읽기가 정적 설명으로 깜빡이지 않게 먼저 pending을 둔다.
      this.put(this.views, deployId, { state: 'pending', content: null })
      void this.explain(deployId)
    })
  }

  /** 실패 티켓을 보내는 지점에서 재료를 담는다(티켓은 이미 비밀값 필터를 거쳤다). */
  rememberTicket(deployId: string, ticket: Record<string, unknown>): void {
    if (!this.enabled) return
    try {
      this.put(this.materials, deployId, materialOf(ticket))
    } catch (err) {
      this.logger.warn(`explain material not kept: ${err instanceof Error ? err.name : 'error'}`)
    }
  }

  /** 성공 처리 시점에 첫 배포였는지 담는다. 같은 알림이 다시 와도 처음 값을 둔다(그때는 live 슬롯이 이미 바뀌어 있다). */
  rememberSuccess(deployId: string, firstDeploy: boolean): void {
    if (!this.enabled || this.firstDeploys.has(deployId)) return
    this.put(this.firstDeploys, deployId, firstDeploy)
  }

  /** 새 티켓 없이 끝나는 실패(AGENT_GAVE_UP)에서 앞 티켓의 재료를 버린다: 이번 실패의 근거가 아니다. */
  forgetTicket(deployId: string): void {
    this.materials.delete(deployId)
  }

  read(deployId: string): ExplanationView | null {
    return this.enabled ? (this.views.get(deployId) ?? null) : null
  }

  async explain(deployId: string): Promise<void> {
    try {
      const run = await this.store.findRun(deployId)
      if (!run || !ENDED_STATUSES.includes(run.status)) return void this.views.delete(deployId)
      const body = explainRequest(run, this.materials.get(deployId), this.firstDeploys.get(deployId))
      if (body === null) return void this.put(this.views, deployId, { state: 'skipped', content: null })
      const content = await this.ask(body)
      this.put(this.views, deployId, content ? { state: 'ready', content } : { state: 'failed', content: null })
    } catch (err) {
      this.logger.warn(`deploy explanation failed: ${err instanceof Error ? err.name : 'error'}`)
      this.put(this.views, deployId, { state: 'failed', content: null })
    } finally {
      this.materials.delete(deployId)
      this.firstDeploys.delete(deployId)
    }
  }

  private async ask(body: Record<string, unknown>): Promise<Explanation | null> {
    if (!this.url || !this.token) return null
    try {
      const res = await fetch(`${this.url}/agent/explanations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (res.status !== 200) {
        void res.body?.cancel()
        this.logger.warn(`AI server answered ${res.status} to POST /agent/explanations`)
        return null
      }
      return parseExplanation(await res.json().catch(() => null))
    } catch (err) {
      this.logger.warn(`AI server not reached for a deploy explanation: ${err instanceof Error ? err.name : 'error'}`)
      return null
    }
  }

  private put<V>(map: Map<string, V>, key: string, value: V): void {
    map.delete(key)
    map.set(key, value)
    if (map.size > MAX_ENTRIES) map.delete(map.keys().next().value!)
  }
}
