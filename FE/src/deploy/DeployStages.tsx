import { Badge } from '../components/ui/Badge.tsx'
import { STAGES } from './stages.ts'
import type { StageCondition, StageKey } from './stages.ts'

// 색만으로 뜻을 전하지 않도록 상태마다 글자를 둔다.
const conditions: Record<StageCondition, { label: string; variant: 'neutral' | 'info' | 'warn' | 'err' }> = {
  waiting: { label: '배포 대기', variant: 'neutral' },
  fixing: { label: '문제 해결 중', variant: 'info' },
  action: { label: '사용자 조치 필요', variant: 'warn' },
  failed: { label: '실패', variant: 'err' },
}

type DeployStagesProps = { current: StageKey; condition?: StageCondition }

function DeployStages({ current, condition }: DeployStagesProps) {
  const currentIndex = STAGES.findIndex((stage) => stage.key === current)
  return (
    <ol aria-label="배포 단계" className="flex flex-col gap-2">
      {STAGES.map((stage, index) => {
        const isCurrent = index === currentIndex
        // 마지막 단계에 닿았고 다른 상태도 없으면 모두 끝난 것이다.
        const finished = index < currentIndex || (isCurrent && stage.key === 'done' && !condition)
        return (
          <li
            key={stage.key}
            aria-current={isCurrent ? 'step' : undefined}
            className={`flex items-center gap-2 text-sm ${index > currentIndex ? 'text-muted' : ''}`}
          >
            <span className={isCurrent ? 'font-bold' : ''}>{stage.label}</span>
            {finished && <Badge variant="ok">끝남</Badge>}
            {isCurrent && !finished && (
              <Badge variant={condition ? conditions[condition].variant : 'info'}>
                {condition ? conditions[condition].label : '진행 중'}
              </Badge>
            )}
            {index > currentIndex && <Badge>대기</Badge>}
          </li>
        )
      })}
    </ol>
  )
}

export default DeployStages
