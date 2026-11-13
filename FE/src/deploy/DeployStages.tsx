import { Steps } from '../components/ui/Steps.tsx'
import { STAGES, stepOf } from './stages.ts'
import type { StageKey, StageState } from './stages.ts'

// 배포 진행 단계 표시. 그리기만 한다. 서버가 준 상태를 단계별 상태로 바꾸는 일은 부모가 맡는다.
function DeployStages({ states }: { states: Record<StageKey, StageState> }) {
  return (
    <Steps
      aria-label="배포 단계"
      steps={STAGES.map(({ key, label }) => ({ label, ...stepOf[states[key]] }))}
    />
  )
}

export default DeployStages
