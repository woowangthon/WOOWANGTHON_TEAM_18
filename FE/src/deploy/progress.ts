import { STAGES } from './stages.ts'
import type { StageKey, StageState } from './stages.ts'

// BE의 배포 시작 · 진행 상태 계약(이슈 #44 · #98, docs/design/api.md "배포 시작 · 진행 상태")의 응답 모양.
export type DeployStatus = 'not_started' | 'running' | 'fixing' | 'needs_user' | 'succeeded' | 'failed'

export type DeployFailure = { code: string; stage: string; service: string | null; message: string }

// AI 에이전트가 낸 해결 결과(submit_result). 학생에게 무엇을 했고 무엇을 해 달라는지 보이려는 값이다.
// status는 verified · pr_opened · needs_user · gave_up이지만 서버가 새 값을 더해도 그릴 수 있게 string으로 받는다.
export type AgentResult = {
  status: string
  summary: string
  userRequest: { message: string; secretKeys: string[] } | null
  prUrl: string | null
  evidence: { ref: string | null; text: string | null }[]
}

export type DeployWarning = { code: string; message: string; service: string | null }

export type Progress = {
  deployId: string
  status: DeployStatus
  stage: string | null
  steps: { key: string; state: string }[]
  failure: DeployFailure | null
  // 결과를 낸 에이전트가 없으면 null. 이 칸이 없던 응답도 같은 뜻으로 읽는다.
  agent?: AgentResult | null
  url: string | null
  // 보안 검사 경고(#45). 배포를 막지 않는다. message는 그대로 보여 줘도 되는 문장이다. 지금은 항상 빈 배열이다.
  warnings: DeployWarning[]
  updatedAt: string
}

export type DeployListItem = {
  id: string
  repo: string
  slug: string
  commit: string
  createdAt: string
  status: DeployStatus
  stage: string | null
  url: string | null
}

// 진행 중일 때만 이 간격으로 다시 읽는다(계약: 3초). succeeded · failed · needs_user · not_started면 멈춘다.
export const POLL_MS = 3000
// 서버가 나중에 새 status를 추가해도(예: 배포 대기) 끝난 것으로 오해해 멈추지 않도록, 알려진 끝 · 대기 상태가 아니면 계속 읽는다.
const SETTLED: string[] = ['not_started', 'needs_user', 'succeeded', 'failed']
export const isActive = (status: string) => !SETTLED.includes(status)

// 모르는 status는 받은 값을 그대로 보인다.
export const statusLabel = (status: string) => {
  switch (status) {
    case 'not_started':
      return '시작 전'
    case 'running':
      return '진행 중'
    case 'fixing':
      return '문제 해결 중'
    case 'needs_user':
      return '사용자 조치 필요'
    case 'succeeded':
      return '완료'
    case 'failed':
      return '실패'
    default:
      return status
  }
}

// 학생이 고칠 수 있는 실패. 계약(docs/design/api.md)은 이 세 코드만 학생의 코드 · 설정에서 난 실패로 정하고,
// 그 밖의 코드(SWITCH_FAILED · TIMED_OUT · AGENT_UNAVAILABLE · 열려 있는 플랫폼 코드)는 학생 잘못이 아니다.
const STUDENT_FAILURES = ['BUILD_FAILED', 'DEPLOY_FAILED', 'VERIFY_FAILED']
// 학생 잘못이 아닌데 플랫폼 문제도 아닌 코드. AGENT_GAVE_UP은 AI 동료가 학생의 실패를 보고도 해결하지 못한 경우라
// "학생 잘못이 아니에요"를 붙이지 않고 AI 동료 칸이 설명한다.
const NOT_PLATFORM = [...STUDENT_FAILURES, 'AGENT_GAVE_UP']

// 학생이 고칠 수 없는 플랫폼 쪽 문제. 이때는 학생 잘못이 아니라고 알린다. 플랫폼 코드는 열려 있어
// 목록으로 알아볼 수 없으므로, 위 코드가 아니면 모두 플랫폼 쪽으로 본다(모르는 코드도 그렇다).
export const isPlatformProblem = (code: string) => !NOT_PLATFORM.includes(code)

// 서버의 steps를 단계별 화면 상태로 바꾼다. 서버는 문제 해결 중(fixing)과 사용자 조치(needs_user)를 status로 주고
// 그때 하는 중인 단계는 active로 남기므로, 그 단계에 상태를 겹친다. 시작 전의 active(비밀값)는 사용자가 할 차례라는 뜻이다.
// 서버가 모르는 key나 값을 주면 그 단계는 대기로 둔다(그리지 못하는 단계가 없게).
export function stageStatesOf({ status, steps }: Pick<Progress, 'status' | 'steps'>): Record<StageKey, StageState> {
  const activeState: StageState =
    status === 'fixing' ? 'fixing' : status === 'needs_user' || status === 'not_started' ? 'action' : 'active'
  const stateOf = (key: StageKey): StageState => {
    switch (steps.find((step) => step.key === key)?.state) {
      case 'done':
        return 'done'
      case 'failed':
        return 'failed'
      case 'active':
        return activeState
      default:
        return 'pending'
    }
  }
  return Object.fromEntries(STAGES.map(({ key }) => [key, stateOf(key)])) as Record<StageKey, StageState>
}

export const statusVariant = (status: string) => {
  switch (status) {
    case 'succeeded':
      return 'ok'
    case 'running':
    case 'fixing':
      return 'info'
    case 'needs_user':
      return 'warn'
    case 'failed':
      return 'err'
    default:
      return 'neutral'
  }
}
