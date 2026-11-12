import { isRecord } from '../common/is-record.js'
import type { Issue } from '../deploys/deploy-input.js'

// 시험 결과 본문 `{ stage, result }`의 검사(api.md "파이프라인 ↔ 플랫폼 서버" 4번). 프레임워크에 기대지 않는 파일로 둔다:
// 파이프라인 쪽 `trial-report`(Infra/pipeline/src/trial-report.spec.ts)가 이 함수를 불러, 보내는 본문이 여기서 받아들여지는지 시험한다.

export type TrialTool = 'run_render' | 'run_deploy' | 'run_verify'

const RESULT_STAGES: Record<TrialTool, string[]> = { run_render: ['render'], run_deploy: ['prepare', 'render', 'apply'], run_verify: ['verify'] }
const PLATFORM_CODE = /^[A-Za-z][A-Za-z0-9_]{2,63}$/

const isStrOrNull = (v: unknown) => v === null || typeof v === 'string'
const isNumOrNull = (v: unknown) => v === null || typeof v === 'number'
const listOf = (v: unknown, item: (x: unknown) => boolean) => Array.isArray(v) && v.every(item)

/** 도구마다의 결과 칸(api.md "MCP 게이트웨이 — 도구" 실행 표)과 검사. */
const SHAPES: Record<TrialTool, Record<string, (v: unknown) => boolean>> = {
  run_render: { status: (v) => v === null || isRecord(v) },
  run_deploy: {
    services: (v) => listOf(v, (s) => isRecord(s) && typeof s.service === 'string' && typeof s.ready === 'boolean' && isStrOrNull(s.reason)),
    pods: (v) => listOf(v, isRecord),
    events: (v) => listOf(v, isRecord),
  },
  run_verify: {
    ready: (v) => listOf(v, (s) => isRecord(s) && typeof s.service === 'string' && typeof s.ready === 'boolean'),
    requests: (v) =>
      listOf(v, (r) => isRecord(r) && typeof r.service === 'string' && typeof r.path === 'string' && isNumOrNull(r.status) && isNumOrNull(r.ms) && isStrOrNull(r.error)),
  },
}

function checkFailure(v: unknown): boolean {
  if (v === null) return true
  return (
    isRecord(v) &&
    Object.keys(v).every((k) => ['stage', 'code', 'message'].includes(k)) &&
    isStrOrNull(v.stage) &&
    (v.code === null || (typeof v.code === 'string' && PLATFORM_CODE.test(v.code))) &&
    typeof v.message === 'string'
  )
}

/** 시험 결과 본문 `{ stage, result }`의 검사. 틀린 칸 목록(맞으면 빈 목록). */
export function checkTrialResult(tool: TrialTool, body: unknown): Issue[] {
  if (!isRecord(body)) return [{ path: 'body', code: 'INVALID_TYPE' }]
  const issues: Issue[] = []
  for (const k of Object.keys(body)) if (k !== 'stage' && k !== 'result') issues.push({ path: k, code: 'UNKNOWN_KEY' })
  if (typeof body.stage !== 'string' || !RESULT_STAGES[tool].includes(body.stage)) issues.push({ path: 'stage', code: 'INVALID_VALUE' })
  const r = body.result
  if (!isRecord(r)) return [...issues, { path: 'result', code: 'INVALID_TYPE' }]
  const shape = SHAPES[tool]
  for (const k of Object.keys(r)) if (k !== 'ok' && k !== 'failure' && !(k in shape)) issues.push({ path: `result.${k}`, code: 'UNKNOWN_KEY' })
  if (typeof r.ok !== 'boolean') issues.push({ path: 'result.ok', code: 'INVALID_TYPE' })
  if (!checkFailure(r.failure)) issues.push({ path: 'result.failure', code: 'INVALID_VALUE' })
  // 통과면 그 도구 스테이지의 마지막에서 failure 없이, 실패면 failure가 있어야 한다.
  const last = RESULT_STAGES[tool].at(-1)
  if (r.ok === true && (body.stage !== last || r.failure !== null)) issues.push({ path: r.failure !== null ? 'result.failure' : 'stage', code: 'MISMATCH' })
  if (r.ok === false && !isRecord(r.failure)) issues.push({ path: 'result.failure', code: 'REQUIRED' })
  for (const [k, ok] of Object.entries(shape)) if (!ok(r[k])) issues.push({ path: `result.${k}`, code: Object.hasOwn(r, k) ? 'INVALID_VALUE' : 'REQUIRED' })
  return issues.slice(0, 20)
}
