import { STAGES } from './stages.ts'
import type { StageKey, StageState } from './stages.ts'

// BE의 배포 시작 · 진행 상태 계약(이슈 #44 · #98, docs/design/api.md "배포 시작 · 진행 상태")의 응답 모양.
export type DeployStatus = 'not_started' | 'running' | 'fixing' | 'needs_user' | 'succeeded' | 'failed'

export type DeployFailure = { code: string; stage: string; service: string | null; message: string }

export type DeployWarning = { code: string; message: string; service: string | null }

export type Progress = {
  deployId: string
  status: DeployStatus
  stage: string | null
  steps: { key: string; state: string }[]
  failure: DeployFailure | null
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

// 학생이 고칠 수 없는 플랫폼 쪽 문제. 이때는 학생 잘못이 아니라고 알린다.
export const isPlatformProblem = (code: string) =>
  ['CODEBUILD_API_ERROR', 'IMAGE_PULL_FAILED', 'LIVE_SLOT_PROTECTED', 'AGENT_UNAVAILABLE'].includes(code)

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
