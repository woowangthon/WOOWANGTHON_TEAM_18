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

// 파이프라인 스테이지의 이름과 고정 설명. AI가 만든 글이 아니다: 설명이 없을 때(기능 꺼짐 · 만들지 못함 · 서버 재시작) 보인다.
export const PIPELINE_STAGES = [
  { stage: 'build', label: '빌드', meaning: '레포 코드로 컨테이너 이미지를 만들어요. 입력이 같으면 전에 만든 이미지를 다시 써요.' },
  { stage: 'prepare', label: '준비', meaning: '지금 서비스 중이 아닌 쪽 슬롯(A 또는 B)을 골라 새 버전을 올릴 준비를 해요.' },
  { stage: 'render', label: '설정 확인', meaning: '배포 설정을 클러스터가 읽는 설정 파일로 바꾸고, 클러스터에 미리 맞는지 물어봐요.' },
  { stage: 'apply', label: '올리기', meaning: '고른 슬롯에 서비스를 띄워요. 공개 주소는 아직 이전 버전을 가리켜요.' },
  { stage: 'verify', label: '동작 확인', meaning: '새 슬롯의 헬스 체크가 통과하는지 확인해요. 실패해도 공개 주소는 바뀌지 않아요.' },
  { stage: 'switch', label: '전환', meaning: '공개 주소를 새 슬롯으로 바꾸고 이전 슬롯을 내려요. 첫 배포면 내릴 슬롯이 없어요.' },
] as const

export const labelOfPipelineStage = (stage: string) => PIPELINE_STAGES.find((s) => s.stage === stage)?.label ?? stage

// 끝난 배포에서 돈 스테이지: 성공이면 모두, 실패면 실패한 스테이지까지. 모르는 스테이지면 모두 보인다.
export function ranStages({ status, failure }: { status: string; failure: { stage: string } | null }) {
  const at = PIPELINE_STAGES.findIndex((s) => s.stage === failure?.stage)
  return status === 'succeeded' || at < 0 ? PIPELINE_STAGES : PIPELINE_STAGES.slice(0, at + 1)
}
