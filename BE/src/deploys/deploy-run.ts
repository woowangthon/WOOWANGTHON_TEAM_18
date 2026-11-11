import { isRecord } from '../common/is-record.js'
import { UUID } from '../common/uuid.js'
import { isImageDigest, type ServiceConditions } from './deploy-condition.js'
import type { Issue, IssueCode } from './deploy-input.js'

// 배포 실행 기록의 상태 규칙(순수 코드, AI가 아니다). 계약은 docs/design/api.md "배포 시작 · 진행 상태".

export const STAGES = ['build', 'prepare', 'render', 'apply', 'verify', 'switch'] as const
export type Stage = (typeof STAGES)[number]

export type RunStatus = 'running' | 'fixing' | 'needs_user' | 'succeeded' | 'failed'
export type DeployStatus = RunStatus | 'not_started'

/** 스테이지가 통과하면 다음 스테이지가 돈다. 마지막(switch)은 null: 완료다. */
export const nextStage = (stage: Stage): Stage | null => STAGES[STAGES.indexOf(stage) + 1] ?? null

/** AI를 부르지 않고 "실패"로 마감하는 플랫폼 문제(deploy-workflow.md §6-3). */
export const PLATFORM_CODES = ['CODEBUILD_API_ERROR', 'IMAGE_PULL_FAILED', 'LIVE_SLOT_PROTECTED'] as const
export type PlatformCode = (typeof PLATFORM_CODES)[number]
const isPlatformCode = (v: unknown): v is PlatformCode => (PLATFORM_CODES as readonly unknown[]).includes(v)

/** AI 에이전트 설계 §5의 티켓 stage는 이 넷뿐이다. */
export const TICKET_STAGES: readonly Stage[] = ['build', 'prepare', 'render', 'apply']

export type FailureCode =
  | 'BUILD_FAILED'
  | 'DEPLOY_FAILED'
  | 'VERIFY_FAILED'
  | 'SWITCH_FAILED'
  | PlatformCode
  | 'AGENT_UNAVAILABLE'

/** 학생에게 그대로 보여 주는 문장. 로그 · 원본 · 비밀값은 여기 들어오지 않는다. */
const MESSAGES: Record<FailureCode, string> = {
  BUILD_FAILED: '이미지를 만드는 중에 문제가 생겼습니다.',
  DEPLOY_FAILED: '서비스를 클러스터에 올리는 중에 문제가 생겼습니다.',
  VERIFY_FAILED: '서비스가 떴지만 동작 확인을 통과하지 못했습니다. 공개 주소는 바뀌지 않았습니다.',
  SWITCH_FAILED: '공개 주소를 새 서비스로 바꾸는 중에 문제가 생겼습니다.',
  CODEBUILD_API_ERROR: '빌드 서비스(CodeBuild)에 문제가 있어 배포하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  IMAGE_PULL_FAILED: '이미지를 클러스터로 받아 오지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  LIVE_SLOT_PROTECTED: '서비스 중인 슬롯을 보호하기 위해 배포를 중단했습니다. 운영자에게 알려 주세요.',
  AGENT_UNAVAILABLE: '문제를 자동으로 해결하는 서비스에 연결하지 못했습니다. 운영자에게 알려 주세요.',
}

export interface StoredFailure {
  code: FailureCode
  stage: Stage
  service: string | null
}

export interface Failure extends StoredFailure {
  message: string
}

export const toFailure = (f: StoredFailure): Failure => ({ ...f, message: MESSAGES[f.code] })

/** 알림이 알려 준 코드와 스테이지로 실패 코드를 정한다. 플랫폼 문제면 AI를 부르지 않는다. */
export function classifyFailure(stage: Stage, platformCode: PlatformCode | null): { code: FailureCode; callAgent: boolean } {
  if (platformCode !== null) return { code: platformCode, callAgent: false }
  const code: FailureCode =
    stage === 'build' ? 'BUILD_FAILED' : stage === 'verify' ? 'VERIFY_FAILED' : stage === 'switch' ? 'SWITCH_FAILED' : 'DEPLOY_FAILED'
  // verify · switch는 티켓 stage에 없어 AI에 넘기지 못한다(api.md "결정 필요").
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

/** 파이프라인 알림의 본문. 모양은 docs/design/api.md "파이프라인 ↔ 플랫폼 서버". */
export type Notice =
  | { deployId: string; stage: Stage; result: 'passed'; images: Record<string, string> | null }
  | {
      deployId: string
      stage: Stage
      result: 'failed'
      failure: { platformCode: PlatformCode | null; service: string | null; message: string; raw: Record<string, unknown>; logs: unknown }
    }

const SERVICE = /^[a-z]([a-z0-9-]{0,50}[a-z0-9])?$/
const MAX_MESSAGE = 2000

export function validateNotice(body: unknown): { ok: true; notice: Notice } | { ok: false; issues: Issue[] } {
  const issues: Issue[] = []
  const add = (path: string, code: IssueCode) => issues.push({ path, code })
  if (!isRecord(body)) return { ok: false, issues: [{ path: '', code: 'INVALID_TYPE' }] }
  const { deployId, stage, result } = body
  if (typeof deployId !== 'string' || !UUID.test(deployId)) add('deployId', deployId === undefined ? 'REQUIRED' : 'INVALID_VALUE')
  if (!(STAGES as readonly unknown[]).includes(stage)) add('stage', stage === undefined ? 'REQUIRED' : 'INVALID_VALUE')
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
  const raw = f.raw ?? {}
  if (!isRecord(raw)) add('failure.raw', 'INVALID_TYPE')
  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    notice: {
      ...base,
      result: 'failed',
      failure: {
        platformCode: code as PlatformCode | null,
        service: service as string | null,
        message: (f.message as string).slice(0, MAX_MESSAGE),
        raw: raw as Record<string, unknown>,
        logs: f.logs ?? null,
      },
    },
  }
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
