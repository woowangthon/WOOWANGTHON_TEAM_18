import type { BuildFailure } from './build.js'
import { isImageDigest, isRecord, parseDeployInput } from './deploy-input.js'
import type { StageFailure } from './failure.js'
import { callPlatform, type PlatformConn, type Sleep } from './platform-api.js'

// 스테이지가 끝났다고 플랫폼 서버에 알린다(`POST /api/pipeline/notify`). 스테이지 CLI가 쓴 결과 JSON을 알림 본문으로 바꾼다.
// 본문의 계약은 docs/design/api.md "파이프라인 ↔ 플랫폼 서버", 받는 쪽의 검사는 BE의 `validateNotice`(BE/src/deploys/deploy-run.ts)다.

export const NOTIFY_STAGES = ['build', 'prepare', 'render', 'apply', 'verify', 'switch'] as const
export type NotifyStage = (typeof NOTIFY_STAGES)[number]

export function parseStage(v: string | undefined): NotifyStage {
  const stage = NOTIFY_STAGES.find((s) => s === v)
  if (stage === undefined) throw new Error(`stage must be one of ${NOTIFY_STAGES.join(', ')}`)
  return stage
}

type Raw = Record<string, unknown>

type FailureBody = {
  code: string | null
  service: string | null
  message: string
  raw?: { codebuild: Raw | null; k8s: { pod: Raw | null; events: unknown[]; status: Raw | null } | null }
  logs?: { from: string; to: string; lines: string[] }
}

export type NoticeBody =
  | { deployId: string; stage: NotifyStage; result: 'passed'; images?: Record<string, string> }
  | { deployId: string; stage: NotifyStage; result: 'failed'; failure: FailureBody }

// BE가 플랫폼 문제 코드로 받는 모양(`^[A-Za-z][A-Za-z0-9_]{2,63}$`)과, BE가 스스로 정하는 코드(파이프라인이 보내면 AI를 건너뛰게 되어 거절한다).
export const PLATFORM_CODE = /^[A-Za-z][A-Za-z0-9_]{2,63}$/
export const BE_OWN_CODES = ['BUILD_FAILED', 'DEPLOY_FAILED', 'VERIFY_FAILED', 'SWITCH_FAILED', 'AGENT_UNAVAILABLE', 'AGENT_GAVE_UP', 'TIMED_OUT']
/** 쓸 수 없는 코드의 대신. `null`로 보내면 학생 문제로 읽혀 AI 에이전트에 넘어가므로 플랫폼 문제로 남겨 둔다(원래 코드는 message에 있다). */
export const FALLBACK_CODE = 'PIPELINE_FAILED'

function platformFailure(code: string, service: string | null, message: string): FailureBody {
  const usable = PLATFORM_CODE.test(code) && !BE_OWN_CODES.includes(code)
  return { code: usable ? code : FALLBACK_CODE, service, message: usable ? message : `${code}: ${message}` }
}

// 학생 문제의 k3s 원본. `status`는 render일 때만 있고(BE가 그 stage에서 객체를 요구한다), 못 읽었으면 오류 문장을 담아 보낸다.
function k8sFailure(stage: NotifyStage, f: Extract<StageFailure, { kind: 'student' }>): FailureBody {
  const status = stage !== 'render' ? null : isRecord(f.raw.status) ? f.raw.status : { message: f.errorMessage }
  return { code: null, service: f.service, message: f.errorMessage, raw: { codebuild: null, k8s: { pod: isRecord(f.raw.pod) ? f.raw.pod : null, events: Array.isArray(f.raw.events) ? f.raw.events : [], status } } }
}

// 시간대가 있는 UTC 문자열로 맞춘다. AWS CLI v2는 ISO 문자열, v1은 epoch 초를 준다. 읽을 수 없으면 null.
function isoTime(v: unknown): string | null {
  const ms = typeof v === 'number' ? v * 1000 : typeof v === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function buildFailure(f: BuildFailure, now: () => number): FailureBody {
  if (f.kind === 'platform') return platformFailure(f.code, f.service, f.message)
  const phase = isRecord(f.failedPhase) ? f.failedPhase : null
  const context = phase !== null && Array.isArray(phase.contexts) ? (phase.contexts as unknown[])[0] : undefined
  const detail = isRecord(context) && typeof context.message === 'string' ? context.message : null
  const message = `build ${f.buildStatus}${typeof phase?.phaseType === 'string' ? ` in ${phase.phaseType}` : ''}${detail === null ? '' : `: ${detail}`}`
  const to = isoTime(f.build.endTime) ?? new Date(now()).toISOString()
  return { code: null, service: f.service, message, raw: { codebuild: f.build, k8s: null }, logs: { from: isoTime(f.build.startTime) ?? to, to, lines: f.logTail ?? [] } }
}

/**
 * 서비스가 여럿 실패했을 때 알릴 하나: 플랫폼 문제가 있으면 그것(AI가 고칠 수 없는 문제가 먼저 드러나야 한다), 없으면 spec 순서로 첫 학생 문제.
 * 빌드 결과는 이미 spec 순서다.
 */
export function pickFailure(failures: BuildFailure[]): BuildFailure | undefined {
  return failures.find((f) => f.kind === 'platform') ?? failures[0]
}

// BE `validateNotice`의 서비스 이름과 시간대가 있는 ISO 8601(AI 서버는 AwareDatetime만 받는다).
export const SERVICE = /^[a-z]([a-z0-9-]{0,50}[a-z0-9])?$/
export const AWARE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

const isString = (v: unknown): v is string => typeof v === 'string'
const isAwareTime = (v: unknown) => isString(v) && AWARE_DATETIME.test(v) && !Number.isNaN(Date.parse(v))

// 문제 티켓으로 가는 실패(BE `checkEvidence`)의 raw · logs. stage별: build는 CodeBuild 원본, 그 밖은 k3s 원본이고 status는 render일 때만 있다.
function evidenceProblem(stage: NotifyStage, f: Record<string, unknown>): string | null {
  const raw = f.raw ?? {}
  if (!isRecord(raw)) return 'failure.raw is not an object'
  if (stage === 'build') {
    if (!isRecord(raw.codebuild)) return 'failure.raw.codebuild is not an object'
    if (raw.k8s != null) return 'failure.raw.k8s must be null on a build'
  } else {
    if (raw.codebuild != null) return 'failure.raw.codebuild must be null'
    const k8s = raw.k8s
    if (!isRecord(k8s)) return 'failure.raw.k8s is not an object'
    if (k8s.pod != null && !isRecord(k8s.pod)) return 'failure.raw.k8s.pod is not an object'
    if (k8s.events != null && !(Array.isArray(k8s.events) && k8s.events.every(isRecord))) return 'failure.raw.k8s.events is not a list of objects'
    const status = k8s.status ?? null
    if (status !== null && !isRecord(status)) return 'failure.raw.k8s.status is not an object'
    if (stage === 'render' && status === null) return 'failure.raw.k8s.status is missing on a render'
    if (stage !== 'render' && status !== null) return 'failure.raw.k8s.status must be null unless render'
  }
  const logs = f.logs
  if (logs == null) return null
  if (!isRecord(logs) || !isAwareTime(logs.from) || !isAwareTime(logs.to)) return 'failure.logs.from or to is not a time with a zone'
  return Array.isArray(logs.lines) && logs.lines.every(isString) ? null : 'failure.logs.lines is not a list of strings'
}

/**
 * 보내기 전의 검사: BE `validateNotice`가 400으로 거절할 본문이면 그 이유를, 아니면 null을 돌려준다. 400은 다시 보내지지 않아
 * 배포가 BE의 1시간 정리까지 멈추므로, 거절될 본문은 보내지 않고 `STAGE_NO_REPORT`로 알린다. BE의 규칙을 한 곳에서 같은 기준으로 옮긴 것이고,
 * 같은 본문에 BE와 같은 답을 하는지는 시험이 대 본다(정규식은 BE와 같은지도 본다).
 */
export function refusal(body: NoticeBody): string | null {
  if (body.result === 'passed') {
    for (const [name, image] of Object.entries(body.images ?? {})) {
      if (!SERVICE.test(name)) return `images.${name} is not a service name`
      if (!isImageDigest(image)) return `images.${name} is not an image digest`
    }
    return null
  }
  const f: Record<string, unknown> = body.failure
  const code = f.code ?? null
  if (code !== null && !(isString(code) && PLATFORM_CODE.test(code) && !BE_OWN_CODES.includes(code))) return 'failure.code is not a usable platform code'
  const service = f.service ?? null
  if (service !== null && !isString(service)) return 'failure.service is not a string'
  if (isString(service) && !SERVICE.test(service)) return 'failure.service is not a service name'
  if (!isString(f.message)) return 'failure.message is not a string'
  // 플랫폼 문제와 switch는 AI 티켓이 되지 않아 증거를 보지 않는다.
  return code !== null || body.stage === 'switch' ? null : evidenceProblem(body.stage, f)
}

/**
 * 스테이지 결과 JSON을 알림 본문으로 바꾼다. 순수 함수다(보내지 않는다).
 * - build: 성공이면 `run` 서비스마다 이미지 digest(`images`), 실패면 `failures`에서 하나를 골라 알린다.
 * - prepare · render · apply · verify · switch: `{ ok, failure }`. 같은 모양이면 verify · switch 결과도 받는다.
 * 결과가 이 모양이 아니면 무엇이 틀렸는지 담아 던진다.
 */
export function noticeFrom(deployId: string, stage: NotifyStage, report: unknown, now: () => number = Date.now): NoticeBody {
  const body = mapReport(deployId, stage, report, now)
  const why = refusal(body)
  if (why !== null) throw new Error(`${stage} report: ${why}`)
  return body
}

function mapReport(deployId: string, stage: NotifyStage, report: unknown, now: () => number): NoticeBody {
  const fail = (what: string) => new Error(`${stage} report: ${what}`)
  if (!isRecord(report) || typeof report.ok !== 'boolean') throw fail('has no boolean ok')
  const base = { deployId, stage }

  if (stage === 'build') {
    if (report.ok) {
      if (!isRecord(report.input)) throw fail('is ok but has no input')
      const images: Record<string, string> = {}
      const { spec, deploy_condition: condition } = parseDeployInput(JSON.stringify(report.input))
      for (const { name } of spec.services) {
        const c = condition.services[name]
        if (c.build !== 'run') continue
        if (!isImageDigest(c.image)) throw fail(`service ${name} was built but has no image digest`)
        images[name] = c.image
      }
      return { ...base, result: 'passed', images }
    }
    const failures = Array.isArray(report.failures) ? (report.failures as unknown[]) : []
    if (!failures.every((f) => isRecord(f) && (f.kind === 'platform' || f.kind === 'build'))) throw fail('has a failure that is neither platform nor build')
    const picked = pickFailure(failures as BuildFailure[])
    if (picked === undefined) throw fail('is not ok but lists no failure')
    return { ...base, result: 'failed', failure: buildFailure(picked, now) }
  }

  if (report.ok) return { ...base, result: 'passed' }
  const f = report.failure
  if (!isRecord(f) || (f.kind !== 'platform' && f.kind !== 'student')) throw fail('is not ok but has no failure of kind platform or student')
  return { ...base, result: 'failed', failure: f.kind === 'platform' ? platformFailure(String(f.code), (f.service as string | null) ?? null, String(f.message)) : k8sFailure(stage, f as Extract<StageFailure, { kind: 'student' }>) }
}

/**
 * 스테이지 결과 파일이 없거나 읽을 수 없을 때(앞 task가 죽었거나 결과의 모양이 틀림)의 알림: 플랫폼 문제 `STAGE_NO_REPORT`로 실패를 알려,
 * 배포가 1시간 시간 초과까지 멈춰 있지 않게 한다. `why`는 결과의 모양이 어디가 틀렸는지(있으면 message에 붙는다).
 */
export const noReportNotice = (deployId: string, stage: NotifyStage, why?: string): NoticeBody => ({
  deployId,
  stage,
  result: 'failed',
  failure: platformFailure('STAGE_NO_REPORT', null, `the ${stage} stage left no readable report${why === undefined ? '' : `: ${why}`}`),
})

/** 알림을 보낸다. 서버가 상태를 바꾸지 않았으면(이미 끝난 배포 · 지금 스테이지가 아님) `applied`가 false다. */
export async function sendNotice(conn: PlatformConn, body: NoticeBody, sleep: Sleep): Promise<{ applied: boolean }> {
  const answer = await callPlatform(conn, 'POST', '/api/pipeline/notify', body, sleep)
  return { applied: !(isRecord(answer) && answer.applied === false) }
}
