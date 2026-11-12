import { isRecord } from '../common/is-record.js'
import { UUID } from '../common/uuid.js'
import { isImageDigest, type ServiceConditions } from './deploy-condition.js'
import type { Issue, IssueCode } from './deploy-input.js'

// 배포 실행 기록의 상태 규칙(순수 코드, AI가 아니다). 계약은 docs/design/api.md "배포 시작 · 진행 상태".

export const STAGES = ['build', 'prepare', 'render', 'apply', 'verify', 'switch'] as const
export type Stage = (typeof STAGES)[number]
export const isStage = (v: unknown): v is Stage => (STAGES as readonly unknown[]).includes(v)

export type RunStatus = 'running' | 'fixing' | 'needs_user' | 'succeeded' | 'failed'
export type DeployStatus = RunStatus | 'not_started'

/** 스테이지가 통과하면 다음 스테이지가 돈다. 마지막(switch)은 null: 완료다. */
export const nextStage = (stage: Stage): Stage | null => STAGES[STAGES.indexOf(stage) + 1] ?? null

/** 플랫폼이 스스로 정하는 실패 코드. 파이프라인이 보낼 수 없다(보내면 AI를 건너뛰게 된다). */
const INTERNAL_CODES = ['BUILD_FAILED', 'DEPLOY_FAILED', 'VERIFY_FAILED', 'SWITCH_FAILED', 'AGENT_UNAVAILABLE', 'AGENT_GAVE_UP', 'TIMED_OUT'] as const
type InternalCode = (typeof INTERNAL_CODES)[number]

/** AI를 부르지 않고 "실패"로 마감하는 플랫폼 문제(deploy-workflow.md §6-3). 코드 집합은 열려 있어, 파이프라인이 새 코드를 추가해도 BE를 고치지 않는다(모양만 본다). */
const PLATFORM_CODE = /^[A-Za-z][A-Za-z0-9_]{2,63}$/
const isPlatformCode = (v: unknown): v is string => typeof v === 'string' && PLATFORM_CODE.test(v) && !(INTERNAL_CODES as readonly string[]).includes(v)

/** AI 에이전트 설계 §5의 티켓 stage(switch는 없다). */
export const TICKET_STAGES: readonly Stage[] = ['build', 'prepare', 'render', 'apply', 'verify']

/** 학생에게 그대로 보여 주는 문장. 로그 · 원본 · 비밀값은 여기 들어오지 않는다. 내부 코드는 하나도 빠지면 안 된다. */
const INTERNAL_MESSAGES: Record<InternalCode, string> = {
  BUILD_FAILED: '이미지를 만드는 중에 문제가 생겼습니다.',
  DEPLOY_FAILED: '서비스를 클러스터에 올리는 중에 문제가 생겼습니다.',
  VERIFY_FAILED: '서비스가 떴지만 동작 확인을 통과하지 못했습니다. 공개 주소는 바뀌지 않았습니다.',
  SWITCH_FAILED: '공개 주소를 새 서비스로 바꾸는 중에 문제가 생겼습니다.',
  AGENT_UNAVAILABLE: '문제를 자동으로 해결하는 서비스에 연결하지 못했습니다. 운영자에게 알려 주세요.',
  AGENT_GAVE_UP: 'AI 에이전트가 이 실패를 해결하지 못했습니다. 배포 설정과 로그를 확인한 뒤 다시 배포해 주세요.',
  TIMED_OUT: '배포가 제한 시간 안에 끝나지 않아 중단했습니다. 다시 시도해 주세요.',
}

// 알려진 플랫폼 코드의 문구. 여기 없는 플랫폼 코드는 일반 문구를 보인다.
const PLATFORM_MESSAGES: Record<string, string> = {
  CODEBUILD_API_ERROR: '빌드 서비스(CodeBuild)에 문제가 있어 배포하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  IMAGE_PULL_FAILED: '이미지를 클러스터로 받아 오지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  LIVE_SLOT_PROTECTED: '서비스 중인 슬롯을 보호하기 위해 배포를 중단했습니다. 운영자에게 알려 주세요.',
  UNEXPECTED_REFUSAL: '클러스터가 예상하지 못한 이유로 요청을 거절해 배포를 중단했습니다. 운영자에게 알려 주세요.',
  TRAEFIK_UNREACHABLE: '동작 확인 중 공개 진입점(Traefik)에 닿지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  SWITCH_REFUSED: '공개 주소를 바꾸는 요청을 클러스터가 거절했습니다. 운영자에게 알려 주세요.',
  OPEN_MANIFEST_MISSING: '공개 주소를 바꾸는 데 필요한 파일이 없어 아무것도 바꾸지 않고 중단했습니다. 운영자에게 알려 주세요.',
  STAGE_NO_REPORT: '배포 단계가 끝났지만 결과 보고를 읽지 못해 배포를 중단했습니다. 운영자에게 알려 주세요.',
  TRIAL_SWITCH_REFUSED: '시험 실행에서는 공개 주소를 바꾸지 않아 전환을 중단했습니다. 공개 주소는 바뀌지 않았습니다. 운영자에게 알려 주세요.',
  TRIAL_STILL_RUNNING: '이전 시험 실행이 아직 끝나지 않아 다음 단계를 시작하지 못했습니다. 잠시 뒤 다시 배포해 주세요.',
}

export interface StoredFailure {
  code: string
  stage: Stage
  service: string | null
}

export interface Failure extends StoredFailure {
  message: string
}

// 코드가 `constructor` · `toString`처럼 Object.prototype의 이름이어도 자기 키만 본다.
const own = (table: Record<string, string>, code: string): string | undefined => (Object.hasOwn(table, code) ? table[code] : undefined)

const messageOf = (code: string): string =>
  own(INTERNAL_MESSAGES, code) ?? own(PLATFORM_MESSAGES, code) ?? '플랫폼 문제로 배포하지 못했습니다. 운영자가 확인합니다.'

export const toFailure = (f: StoredFailure): Failure => ({ ...f, message: messageOf(f.code) })

/** 알림이 알려 준 코드와 스테이지로 실패 코드를 정한다. 플랫폼 문제면 AI를 부르지 않는다. */
export function classifyFailure(stage: Stage, platformCode: string | null): { code: string; callAgent: boolean } {
  if (platformCode !== null) return { code: platformCode, callAgent: false }
  const code: string =
    stage === 'build' ? 'BUILD_FAILED' : stage === 'verify' ? 'VERIFY_FAILED' : stage === 'switch' ? 'SWITCH_FAILED' : 'DEPLOY_FAILED'
  return { code, callAgent: TICKET_STAGES.includes(stage) }
}

export const STEP_KEYS = ['intake', 'analysis', 'config', 'secrets', 'build', 'deploy', 'verify', 'done'] as const
export type StepKey = (typeof STEP_KEYS)[number]
export type StepState = 'done' | 'active' | 'pending' | 'failed'

const STEP_OF_STAGE: Record<Stage, StepKey> = {
  build: 'build',
  prepare: 'deploy',
  render: 'deploy',
  apply: 'deploy',
  verify: 'verify',
  switch: 'done',
}

/** FR-060의 단계 8개와 각 상태. 저장된 배포 입력이 있으면 접수 · 분석 · 배포 설정은 끝난 것이다. */
export function buildSteps(status: DeployStatus, stage: Stage | null): { key: StepKey; state: StepState }[] {
  if (status === 'succeeded') return STEP_KEYS.map((key) => ({ key, state: 'done' }))
  // 시작 전에는 비밀값 단계에서 기다린다. 시작한 뒤에는 비밀값까지 끝났다.
  const current: StepKey = status === 'not_started' ? 'secrets' : STEP_OF_STAGE[stage ?? 'build']
  const at = STEP_KEYS.indexOf(current)
  return STEP_KEYS.map((key, i) => ({
    key,
    state: i < at ? 'done' : i > at ? 'pending' : status === 'failed' ? 'failed' : 'active',
  }))
}

export const publicUrl = (slug: string) => `https://${slug}.stairnoworks.com`

/** 문제 티켓에 담을 증거. AI 서버의 모델(AI/ai_server/agent/models.py)이 받는 모양으로 이미 맞춰 둔다. */
export interface TicketEvidence {
  raw: { codebuild: Record<string, unknown> | null; k8s: { pod: Record<string, unknown> | null; events: Record<string, unknown>[]; status: Record<string, unknown> | null } | null }
  logs: { from: string; to: string; lines: string[] } | null
}

/** 파이프라인 알림의 본문. 모양은 docs/design/api.md "파이프라인 ↔ 플랫폼 서버". */
export type Notice =
  | { deployId: string; stage: Stage; result: 'passed'; images: Record<string, string> | null }
  | {
      deployId: string
      stage: Stage
      result: 'failed'
      // evidence: 이 실패를 AI 서버에 넘길 때만(`classifyFailure(...).callAgent`) 있다.
      failure: { platformCode: string | null; service: string | null; message: string; evidence: TicketEvidence | null }
    }

const SERVICE = /^[a-z]([a-z0-9-]{0,50}[a-z0-9])?$/
const MAX_MESSAGE = 2000

export function validateNotice(body: unknown): { ok: true; notice: Notice } | { ok: false; issues: Issue[] } {
  const issues: Issue[] = []
  const add = (path: string, code: IssueCode) => issues.push({ path, code })
  if (!isRecord(body)) return { ok: false, issues: [{ path: '', code: 'INVALID_TYPE' }] }
  const { deployId, stage, result } = body
  if (typeof deployId !== 'string' || !UUID.test(deployId)) add('deployId', deployId === undefined ? 'REQUIRED' : 'INVALID_VALUE')
  if (!isStage(stage)) add('stage', stage === undefined ? 'REQUIRED' : 'INVALID_VALUE')
  if (result !== 'passed' && result !== 'failed') add('result', result === undefined ? 'REQUIRED' : 'INVALID_VALUE')
  if (issues.length > 0) return { ok: false, issues }
  const base = { deployId: (deployId as string).toLowerCase(), stage: stage as Stage }

  if (result === 'passed') {
    if (stage === 'build') {
      const images = body.images
      if (!isRecord(images)) add('images', images === undefined ? 'REQUIRED' : 'INVALID_TYPE')
      else
        for (const [name, image] of Object.entries(images)) {
          if (!SERVICE.test(name)) add(`images.${name}`, 'INVALID_VALUE')
          else if (!isImageDigest(image)) add(`images.${name}`, 'INVALID_VALUE')
        }
      if (issues.length > 0) return { ok: false, issues }
      return { ok: true, notice: { ...base, result: 'passed', images: body.images as Record<string, string> } }
    }
    if (body.images !== undefined) add('images', 'UNKNOWN_KEY')
    if (issues.length > 0) return { ok: false, issues }
    return { ok: true, notice: { ...base, result: 'passed', images: null } }
  }

  const f = body.failure
  if (!isRecord(f)) return { ok: false, issues: [{ path: 'failure', code: f === undefined ? 'REQUIRED' : 'INVALID_TYPE' }] }
  const code = f.code ?? null
  if (code !== null && !isPlatformCode(code)) add('failure.code', 'INVALID_VALUE')
  const service = f.service ?? null
  if (service !== null && (typeof service !== 'string' || !SERVICE.test(service))) add('failure.service', 'INVALID_VALUE')
  if (typeof f.message !== 'string') add('failure.message', f.message === undefined ? 'REQUIRED' : 'INVALID_TYPE')
  const platformCode = code as string | null
  const evidence = classifyFailure(base.stage, platformCode).callAgent ? checkEvidence(base.stage, f, add) : null
  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    notice: {
      ...base,
      result: 'failed',
      failure: { platformCode, service: service as string | null, message: (f.message as string).slice(0, MAX_MESSAGE), evidence },
    },
  }
}

const MAX_LOG_LINES = 200
// 시간대가 있는 ISO 8601(AI 서버는 AwareDatetime만 받는다).
const AWARE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

/**
 * 문제 티켓으로 갈 실패의 `raw` · `logs`를 AI 서버가 받는 모양으로 확인한다(stage별: build는 CodeBuild 원본, 그 밖은 k3s 원본이고
 * `status`는 render일 때만 있다). 안 맞으면 파이프라인에 400으로 알려 보내는 쪽이 보이게 한다. 안쪽 객체는 원본 그대로 넘긴다.
 */
function checkEvidence(stage: Stage, f: Record<string, unknown>, add: (path: string, code: IssueCode) => void): TicketEvidence | null {
  const rawIn = f.raw ?? {}
  if (!isRecord(rawIn)) {
    add('failure.raw', 'INVALID_TYPE')
    return null
  }
  const optionalRecord = (v: unknown, path: string): Record<string, unknown> | null => {
    if (v === undefined || v === null) return null
    if (isRecord(v)) return v
    add(path, 'INVALID_TYPE')
    return null
  }

  let raw: TicketEvidence['raw']
  if (stage === 'build') {
    const codebuild = optionalRecord(rawIn.codebuild, 'failure.raw.codebuild')
    if (codebuild === null) add('failure.raw.codebuild', rawIn.codebuild === undefined || rawIn.codebuild === null ? 'REQUIRED' : 'INVALID_TYPE')
    if (rawIn.k8s !== undefined && rawIn.k8s !== null) add('failure.raw.k8s', 'MUST_BE_NULL')
    raw = { codebuild, k8s: null }
  } else {
    if (rawIn.codebuild !== undefined && rawIn.codebuild !== null) add('failure.raw.codebuild', 'MUST_BE_NULL')
    const k8sIn = rawIn.k8s
    if (!isRecord(k8sIn)) {
      add('failure.raw.k8s', k8sIn === undefined || k8sIn === null ? 'REQUIRED' : 'INVALID_TYPE')
      raw = { codebuild: null, k8s: null }
    } else {
      const pod = optionalRecord(k8sIn.pod, 'failure.raw.k8s.pod')
      const eventsIn = k8sIn.events ?? []
      let events: Record<string, unknown>[] = []
      if (Array.isArray(eventsIn) && eventsIn.every(isRecord)) events = eventsIn
      else add('failure.raw.k8s.events', 'INVALID_TYPE')
      const status = optionalRecord(k8sIn.status, 'failure.raw.k8s.status')
      if (stage === 'render' && status === null) add('failure.raw.k8s.status', 'REQUIRED')
      if (stage !== 'render' && status !== null) add('failure.raw.k8s.status', 'MUST_BE_NULL')
      raw = { codebuild: null, k8s: { pod, events, status } }
    }
  }

  let logs: TicketEvidence['logs'] = null
  const logsIn = f.logs
  if (logsIn !== undefined && logsIn !== null) {
    const { from, to, lines } = isRecord(logsIn) ? logsIn : ({} as Record<string, unknown>)
    const awareTime = (v: unknown): v is string => typeof v === 'string' && AWARE_DATETIME.test(v) && !Number.isNaN(Date.parse(v))
    if (!awareTime(from)) add('failure.logs.from', from === undefined ? 'REQUIRED' : 'INVALID_VALUE')
    if (!awareTime(to)) add('failure.logs.to', to === undefined ? 'REQUIRED' : 'INVALID_VALUE')
    if (!Array.isArray(lines) || !lines.every((l) => typeof l === 'string')) add('failure.logs.lines', lines === undefined ? 'REQUIRED' : 'INVALID_TYPE')
    else if (awareTime(from) && awareTime(to)) logs = { from, to, lines: lines.slice(-MAX_LOG_LINES) }
  }
  return { raw, logs }
}

/** build가 끝났을 때 알린 이미지가 이번 실행의 `run` 서비스와 맞는지 본다. 어긋난 칸을 `images.<name>`으로 알린다. */
export function checkImages(conditions: ServiceConditions, images: Record<string, string>): Issue[] {
  const issues: Issue[] = []
  for (const [name, cond] of Object.entries(conditions)) {
    if (cond.build === 'run' && !Object.hasOwn(images, name)) issues.push({ path: `images.${name}`, code: 'REQUIRED' })
  }
  for (const name of Object.keys(images)) {
    if (conditions[name]?.build !== 'run') issues.push({ path: `images.${name}`, code: 'UNKNOWN_KEY' })
  }
  return issues
}

/** AI 에이전트 티켓은 실행 기록당 이만큼까지다(api.md "파이프라인 ↔ 플랫폼 서버" 5번). */
export const MAX_TICKETS = 3

/**
 * 이 실행 기록에서 지금 티켓이 몇 번째인가. 센 값은 `agent_result.tickets`에 둔다(칸을 더하지 않는다):
 * 첫 티켓 뒤 새 티켓은 `verified` 뒤 다시 실행이 실패할 때만 나오고, 그때 `agent_result`는 앞 티켓의 결과다.
 */
export function ticketCount(run: { agent_result?: Record<string, unknown> | null } | undefined): number {
  const before = run?.agent_result?.tickets
  return (typeof before === 'number' && Number.isInteger(before) && before > 0 ? before : 0) + 1
}
