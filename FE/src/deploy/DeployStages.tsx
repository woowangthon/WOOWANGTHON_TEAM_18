import { Badge } from '../components/ui/Badge.tsx'
import { STAGES, stateLabels } from './stages.ts'
import type { StageKey, StageState } from './stages.ts'

// 린트가 객체 안의 문자열을 전부 클래스로 읽어서(Alert.tsx와 같은 이유) 함수로 둔다.
function variantOf(state: StageState) {
  switch (state) {
    case 'done':
      return 'ok'
    case 'active':
    case 'fixing':
      return 'info'
    case 'action':
      return 'warn'
    case 'failed':
      return 'err'
    case 'pending':
    case 'queued':
    case 'skipped':
      return 'neutral'
  }
}
// 지나갔거나 아직 오지 않은 단계. 나머지는 지금 눈여겨볼 단계다.
const quiet = new Set<StageState>(['pending', 'done', 'skipped'])

// 배포 진행 단계 표시. 그리기만 한다. 서버가 준 상태를 단계별 상태로 바꾸는 일은 부모가 맡는다.
function DeployStages({ states }: { states: Record<StageKey, StageState> }) {
  return (
    <ol aria-label="배포 단계" className="flex flex-col gap-2">
      {STAGES.map(({ key, label }) => {
        const state = states[key]
        const attention = !quiet.has(state)
        return (
          <li
            key={key}
            aria-current={attention ? 'step' : undefined}
            className={`flex items-center gap-2 text-sm ${state === 'pending' ? 'text-muted' : ''}`}
          >
            <span className={attention ? 'font-bold' : ''}>{label}</span>
            <Badge variant={variantOf(state)}>{stateLabels[state]}</Badge>
          </li>
        )
      })}
    </ol>
  )
}

export default DeployStages
