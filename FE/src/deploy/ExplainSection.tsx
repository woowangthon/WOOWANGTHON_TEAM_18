import { Card } from '../components/ui/Card.tsx'
import { Spinner } from '../components/ui/Spinner.tsx'
import type { Progress } from './progress.ts'
import { labelOfPipelineStage as labelOf, ranStages } from './stages.ts'

function StaticGuide({ progress }: { progress: Progress }) {
  return (
    <ol className="flex flex-col gap-2">
      {ranStages(progress).map(({ stage, label, meaning }) => (
        <li key={stage}>
          <span className="font-bold">{label}</span> — {meaning}
        </li>
      ))}
    </ol>
  )
}

// 끝난 배포의 설명. 서버가 준 AI 설명(ready)이 있으면 그것을, 없으면 고정 단계 안내를 보인다. 고정 안내를 "AI 설명"이라고 부르지 않는다.
// waitOver: 설명을 기다리다 읽기 상한에 닿았다(pending인 채로 멈춤).
function ExplainSection({ progress, waitOver = false }: { progress: Progress; waitOver?: boolean }) {
  const view = progress.explanation
  if (view?.state === 'ready') {
    const { summary, steps, cause, actions, terms } = view.content
    return (
      <Card role="region" aria-label="AI 배포 설명" className="flex flex-col gap-3">
        <h2 className="text-lg">AI 배포 설명</h2>
        <p>{summary}</p>
        {steps.length > 0 && (
          <ol className="flex flex-col gap-2">
            {steps.map((step, index) => (
              <li key={`${step.stage}-${index}`}>
                <span className="font-bold">{labelOf(step.stage)}</span> — {step.did}
                <p className="text-sm text-muted">{step.meaning}</p>
              </li>
            ))}
          </ol>
        )}
        {cause && (
          <div className="flex flex-col gap-1">
            <p className="font-bold">그럴듯한 원인</p>
            <p>{cause}</p>
          </div>
        )}
        {actions.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="font-bold">다음에 할 일</p>
            <ul className="list-disc pl-5">
              {actions.map((action, index) => (
                <li key={index}>{action}</li>
              ))}
            </ul>
          </div>
        )}
        {terms.length > 0 && (
          <details>
            <summary className="cursor-pointer text-muted">용어 풀이</summary>
            <dl className="mt-2 flex flex-col gap-1">
              {terms.map(({ term, meaning }, index) => (
                <div key={index}>
                  <dt className="inline font-mono">{term}</dt>: <dd className="inline">{meaning}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
        <p className="text-sm text-muted">AI가 이번 배포 기록으로 만든 설명이에요. 틀릴 수 있어요.</p>
      </Card>
    )
  }
  const pending = view?.state === 'pending' && !waitOver
  return (
    <Card role="region" aria-label="배포 단계 안내" className="flex flex-col gap-3">
      <h2 className="text-lg">배포 단계 안내</h2>
      {pending && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <Spinner size="sm" aria-hidden="true" />
          AI가 이번 배포를 설명하는 중이에요…
        </p>
      )}
      <StaticGuide progress={progress} />
    </Card>
  )
}

export default ExplainSection
