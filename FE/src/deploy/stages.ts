// 배포 진행 단계(#99, UC-08, FR-060). 단계 이름과 순서는 SRS FR-060과 deploy-workflow.md 2절을 따른다.
// 서버가 상태를 어떤 값으로 주는지는 BE의 진행 상태 읽기 계약(#98)이 정한다. 그 값을 아래 키로 바꾸는 일은 부모가 맡는다.
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
// 현재 단계에 겹쳐 보이는 상태. 없으면 정상 진행이다.
export type StageCondition = 'waiting' | 'fixing' | 'action' | 'failed'
