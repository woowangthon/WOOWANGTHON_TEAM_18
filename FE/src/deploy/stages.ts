import type { StepState } from '../components/ui/Steps.tsx'

// 배포 진행 단계(#99, UC-08, FR-060). 이름과 순서는 SRS FR-060과 BE의 진행 상태 계약(`steps`의 key)을 따른다.
export const STAGES = [
  { key: 'intake', label: '접수' },
  { key: 'analysis', label: '분석' },
  { key: 'config', label: '배포 설정' },
  { key: 'secrets', label: '비밀값' },
  { key: 'build', label: '빌드' },
  { key: 'deploy', label: '배포' },
  { key: 'verify', label: '동작 확인' },
  { key: 'done', label: '완료' },
] as const

export type StageKey = (typeof STAGES)[number]['key']

// 한 단계가 지금 어떤 상태인지. 어떤 단계가 어떤 상태가 될 수 있는지, 어느 단계가 건너뛰어지는지는
// 서버가 진행 상태를 어떻게 주는지(BE #98)에 달려 있어서 여기서 가르지 않고 부모가 정한다.
// pending: 아직 차례가 아님 · queued: 자리를 기다리는 중(배포 대기) · active: 하는 중 · done: 끝남 · skipped: 건너뜀
// fixing: 문제 해결 중(AI 에이전트) · action: 사용자 조치 필요 · failed: 실패
export type StageState = 'pending' | 'queued' | 'active' | 'done' | 'skipped' | 'fixing' | 'action' | 'failed'

// 화면의 단계 목록(Steps)은 완료 · 진행 중 · 입력 대기 · 실패 · 예정 다섯 가지 글자만 쓴다(색만으로 뜻을 전하지 않는다).
// 그보다 잘게 나뉜 상태는 같은 글자 아래 짧은 설명(note)으로 보탠다.
export const stepOf: Record<StageState, { state: StepState; note?: string }> = {
  pending: { state: 'pend' },
  queued: { state: 'pend', note: '배포 대기' },
  active: { state: 'run' },
  done: { state: 'done' },
  skipped: { state: 'pend', note: '건너뜀' },
  fixing: { state: 'run', note: '문제 해결 중' },
  action: { state: 'wait', note: '사용자 조치 필요' },
  failed: { state: 'fail' },
}
