// 배포 진행 단계(#99, UC-08, FR-060). 단계 이름과 순서는 SRS FR-060과 deploy-workflow.md 2절을 따른다.
export const STAGES = [
  { key: 'received', label: '접수' },
  { key: 'analysis', label: '분석' },
  { key: 'spec', label: '배포 설정' },
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

// 색만으로 뜻을 전하지 않도록 상태마다 글자를 둔다.
export const stateLabels: Record<StageState, string> = {
  pending: '대기',
  queued: '배포 대기',
  active: '진행 중',
  done: '끝남',
  skipped: '건너뜀',
  fixing: '문제 해결 중',
  action: '사용자 조치 필요',
  failed: '실패',
}
