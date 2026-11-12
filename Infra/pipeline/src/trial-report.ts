import { byRole } from './apply.js'
import type { BuildFailure } from './build.js'
import { type DeployInput, isRecord, parseDeployInput } from './deploy-input.js'
import type { StageFailure } from './failure.js'
import { buildFailure, pickFailure, platformFailure } from './notify.js'
import { callPlatform, type PlatformConn, type Sleep } from './platform-api.js'

// AI 에이전트 시험 실행(student-trial)의 결과 보내기. 범위 안 스테이지 job마다 `run_if: any`로 돌고, 시험 하나에 한 번만 보낸다:
// 실패한 스테이지에서, 모두 통과했으면 TRIAL_STAGES의 마지막 스테이지에서. 본문은 `{ stage, result }`이고 result는 그 시험을 부른
// 도구의 결과 모양 + failure다(docs/design/api.md "파이프라인 ↔ 플랫폼 서버" 4번). 받는 쪽의 검사는 BE의 checkTrialResult(BE/src/gateway/trial-result.ts).
// failure.message는 배포 알림(notify.ts)과 같은 문장이다: 같은 함수로 만든다.

export type TrialStage = 'build' | 'prepare' | 'render' | 'apply' | 'verify'
export type TrialTool = 'run_build' | 'run_render' | 'run_deploy' | 'run_verify'

/** TRIAL_STAGES 값(api.md 4번 표의 넷)과 그 도구 · 스테이지 목록. */
const TOOLS: Record<string, { tool: TrialTool; stages: TrialStage[] }> = {
  build: { tool: 'run_build', stages: ['build'] },
  render: { tool: 'run_render', stages: ['render'] },
  'prepare,render,apply': { tool: 'run_deploy', stages: ['prepare', 'render', 'apply'] },
  verify: { tool: 'run_verify', stages: ['verify'] },
}

export interface Trial {
  tool: TrialTool
  stages: TrialStage[]
}

export function parseTrialStages(v: string | undefined): Trial {
  if (v === undefined || !Object.hasOwn(TOOLS, v)) throw new Error(`TRIAL_STAGES must be one of ${Object.keys(TOOLS).join(' | ')}`)
  return { tool: TOOLS[v].tool, stages: [...TOOLS[v].stages] }
}

export function parseTrialStage(v: string | undefined): TrialStage {
  const all: TrialStage[] = ['build', 'prepare', 'render', 'apply', 'verify']
  const stage = all.find((s) => s === v)
  if (stage === undefined) throw new Error(`stage must be one of ${all.join(', ')}`)
  return stage
}

export interface TrialFailure {
  stage: TrialStage
  code: string | null
  message: string
}

export interface TrialBody {
  stage: TrialStage
  result: Record<string, unknown> & { ok: boolean; failure: TrialFailure | null }
}

/** 그 도구의 결과 칸을 비운 값. 결과를 모을 리포트가 없거나, 실패해서 그 칸을 채울 것이 없을 때 쓴다. */
const EMPTY: Record<TrialTool, Record<string, unknown>> = {
  run_build: { reused: false, build: null, failedPhase: null, logTail: [], image: null },
  run_render: { status: null },
  run_deploy: { services: [], pods: [], events: [] },
  run_verify: { ready: [], requests: [] },
}

const empty = (tool: TrialTool) => structuredClone(EMPTY[tool])

/** 스테이지 결과가 없거나 읽을 수 없을 때: 플랫폼 문제 STAGE_NO_REPORT(배포 알림의 noReportNotice와 같은 문장). 게이트웨이가 30분 기다리지 않게 바로 보낸다. */
export function noReportBody(trial: Trial, stage: TrialStage, why?: string): TrialBody {
  const f = platformFailure('STAGE_NO_REPORT', null, `the ${stage} stage left no readable report${why === undefined ? '' : `: ${why}`}`)
  return { stage, result: { ok: false, ...empty(trial.tool), failure: { stage, code: f.code, message: f.message } } }
}

/** prepare · render · apply · verify 실패의 failure 칸: 플랫폼 문제는 배포 알림과 같은 코드(쓸 수 없는 코드는 PIPELINE_FAILED), 학생 문제는 code null + 그 문장. */
function stageFailure(stage: TrialStage, f: StageFailure): TrialFailure {
  if (f.kind === 'platform') {
    const p = platformFailure(f.code, f.service, f.message)
    return { stage, code: p.code, message: p.message }
  }
  return { stage, code: null, message: f.errorMessage }
}

// 학생 문제의 k3s 원본(Pod · 이벤트). 플랫폼 문제에는 없다.
function rawK8s(f: StageFailure): { pods: Record<string, unknown>[]; events: Record<string, unknown>[] } {
  if (f.kind !== 'student') return { pods: [], events: [] }
  return { pods: isRecord(f.raw.pod) ? [f.raw.pod] : [], events: Array.isArray(f.raw.events) ? f.raw.events.filter(isRecord) : [] }
}

const stringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string')

/**
 * 스테이지 결과 JSON을 시험 결과 본문으로 바꾼다. 보낼 차례가 아니면(통과했고 TRIAL_STAGES의 마지막이 아님) null이다. 순수 함수다(보내지 않는다).
 * `input`은 그 job이 읽은 시험 입력(run_deploy의 서비스 목록). 결과의 모양이 틀리면 무엇이 틀렸는지 담아 던진다(호출하는 쪽이 STAGE_NO_REPORT로 보낸다).
 */
export function trialBodyFrom(trial: Trial, stage: TrialStage, report: unknown, input: DeployInput, now: () => number = Date.now): TrialBody | null {
  const fail = (what: string) => new Error(`${stage} report: ${what}`)
  if (!trial.stages.includes(stage)) throw fail(`stage ${stage} is not in this trial (${trial.stages.join(',')})`)
  if (!isRecord(report) || typeof report.ok !== 'boolean') throw fail('has no boolean ok')
  // 통과한 리포트에 실패가 실려 있으면 스테이지 CLI의 버그다. 어느 쪽을 믿을지 모르므로 보내지 않고 모양 오류로 둔다(build 리포트는 failure 칸이 없고 failures 목록으로 본다).
  if (report.ok && report.failure !== undefined && report.failure !== null) throw fail('is ok but has a failure')
  const last = trial.stages.at(-1) === stage
  if (report.ok && !last) return null

  if (stage === 'build') return buildBody(report, now, fail)

  const failure = report.ok ? null : report.failure
  if (!report.ok && (!isRecord(failure) || (failure.kind !== 'platform' && failure.kind !== 'student'))) throw fail('is not ok but has no failure of kind platform or student')
  const f = failure as StageFailure | null
  const base = { ok: report.ok, failure: f === null ? null : stageFailure(stage, f) }

  if (trial.tool === 'run_render') {
    const status = f !== null && f.kind === 'student' && isRecord(f.raw.status) ? f.raw.status : null
    return { stage, result: { ...base, status } }
  }

  if (trial.tool === 'run_verify') {
    if (!Array.isArray(report.ready) || !Array.isArray(report.requests)) throw fail('has no ready and requests lists')
    return { stage, result: { ...base, ready: report.ready as unknown[], requests: report.requests as unknown[] } }
  }

  // run_deploy. Prepare · Render에서 실패하면 서비스 칸을 채울 것이 없다(원인은 failure). Render 학생 문제의 Status 원본은 싣지 않는다(run_render로 본다).
  const raw = f === null ? { pods: [], events: [] } : rawK8s(f)
  if (stage !== 'apply') return { stage, result: { ...base, services: [], ...raw } }
  if (!stringList(report.ready)) throw fail('has no ready list of service names')
  const ready = new Set(report.ready)
  const failed = f?.service ?? null
  // 적용 순서(AI → BE → FE). Ready가 된 것, 실패한 것, 실패 뒤라 적용하지 못한 것.
  const services = byRole(input.spec.services).map(({ name }) => {
    if (ready.has(name)) return { service: name, ready: true, reason: null }
    if (name === failed && base.failure !== null) return { service: name, ready: false, reason: base.failure.message }
    return { service: name, ready: false, reason: 'not applied' }
  })
  return { stage, result: { ...base, services, ...raw } }
}

/**
 * run_build: 입력의 `run` 서비스 하나를 빌드한 결과. BE는 그 서비스가 `reuse`로 정해지면 시험을 돌리지 않고 바로 답하므로(api.md 4번),
 * 여기 오는 입력에는 `run`이 꼭 하나다. 아니면 플랫폼 문제 TRIAL_INPUT_INVALID로 알린다(어느 서비스의 이미지를 알릴지 정할 수 없다).
 */
function buildBody(report: Record<string, unknown>, now: () => number, fail: (what: string) => Error): TrialBody {
  const stage = 'build'
  if (!isRecord(report.input)) throw fail('has no input')
  const input = parseDeployInput(JSON.stringify(report.input))
  const run = input.spec.services.filter((s) => input.deploy_condition.services[s.name].build === 'run').map((s) => s.name)
  if (run.length !== 1) {
    const message = `a run_build trial builds exactly one service, but the input has ${run.length} to build${run.length > 0 ? ` (${run.join(', ')})` : ''}`
    return { stage, result: { ok: false, ...empty('run_build'), failure: { stage, code: 'TRIAL_INPUT_INVALID', message } } }
  }
  const [service] = run
  const failures = Array.isArray(report.failures) ? (report.failures as unknown[]) : []
  if (!failures.every((f) => isRecord(f) && (f.kind === 'platform' || f.kind === 'build'))) throw fail('has a failure that is neither platform nor build')
  const picked = pickFailure((failures as BuildFailure[]).filter((f) => f.service === service))
  if (report.ok !== (picked === undefined)) throw fail(report.ok ? 'is ok but lists a failure' : 'is not ok but lists no failure of the built service')
  const image = input.deploy_condition.services[service].image
  if (picked === undefined) {
    if (image === null) throw fail(`service ${service} was built but has no image digest`)
    return { stage, result: { ok: true, ...empty('run_build'), image, failure: null } }
  }
  const body = buildFailure(picked, now)
  const failure: TrialFailure = { stage, code: body.code, message: body.message }
  if (picked.kind === 'platform') return { stage, result: { ok: false, ...empty('run_build'), failure } }
  const phaseType = isRecord(picked.failedPhase) && typeof picked.failedPhase.phaseType === 'string' ? picked.failedPhase.phaseType : null
  return { stage, result: { ok: false, reused: false, build: picked.build, failedPhase: phaseType, logTail: picked.logTail ?? [], image: null, failure } }
}

/** 결과를 보낸다. 서버가 받지 않았으면(모르는 · 끝난 시험의 늦은 결과) `applied`가 false다. */
export async function sendTrialResult(conn: PlatformConn, trialId: string, body: TrialBody, sleep: Sleep): Promise<{ applied: boolean }> {
  const answer = await callPlatform(conn, 'POST', `/api/pipeline/trials/${trialId}/result`, body, sleep)
  return { applied: !(isRecord(answer) && answer.applied === false) }
}
