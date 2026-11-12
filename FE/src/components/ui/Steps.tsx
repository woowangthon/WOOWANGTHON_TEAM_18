import type { ReactNode } from 'react'

const states = {
  done: {
    dot: 'border-accent bg-accent text-accent-fg',
    label: 'text-fg',
    text: '완료',
  },
  run: { dot: 'border-2 border-accent-ui bg-bg text-fg', label: 'font-bold text-fg', text: '진행 중' },
  wait: { dot: 'border-2 border-warn bg-bg text-warn', label: 'font-bold text-fg', text: '대기' },
  fail: { dot: 'border-2 border-err bg-bg text-err', label: 'font-bold text-fg', text: '실패' },
  pend: { dot: 'border-line-strong bg-bg text-muted', label: 'text-muted', text: '예정' },
}

export type StepState = keyof typeof states
export type Step = { label: ReactNode; state: StepState; note?: ReactNode }

// 세로 단계 목록. 단계 상태는 화면이 정한다. 상태는 색 말고 글자(sr-only)로도 읽힌다.
export function Steps({ steps, 'aria-label': ariaLabel }: { steps: Step[]; 'aria-label': string }) {
  return (
    <ol aria-label={ariaLabel} className="m-0 list-none p-0">
      {steps.map((s, i) => {
        const v = states[s.state]
        const last = i === steps.length - 1
        return (
          <li
            key={i}
            aria-current={s.state === 'run' ? 'step' : undefined}
            className="relative flex items-start gap-3 pb-4 last:pb-0"
          >
            {!last && (
              <span
                aria-hidden="true"
                className={`absolute top-6 bottom-0 left-2.75 w-0.5 ${s.state === 'done' ? 'bg-accent-ui' : 'bg-line'}`}
              />
            )}
            <span
              aria-hidden="true"
              className={`box-border flex h-6 w-6 flex-none items-center justify-center rounded-full border text-xs font-bold ${v.dot}`}
            >
              {s.state === 'done' ? '✓' : s.state === 'fail' ? '!' : i + 1}
            </span>
            <span className={`pt-0.5 ${v.label}`}>
              {s.label}
              <span className="sr-only"> ({v.text})</span>
              {s.note ? <span className="block text-xs font-normal text-muted">{s.note}</span> : null}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
