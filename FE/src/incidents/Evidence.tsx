import { waitingText } from '../deploy/metrics.ts'
import type { IncidentEvidence } from './types.ts'

// "알림 근거": 알림을 연 때 읽은 Pod 상태 한 줄과 로그 마지막 줄들(펼쳐 본다). 근거가 없으면 아무것도 그리지 않는다.
function Evidence({ evidence }: { evidence: IncidentEvidence | null }) {
  if (!evidence) return null
  const { restarts, waiting, lastExit, logs } = evidence
  const facts = [
    `재시작 ${restarts}번`,
    ...(lastExit ? [`마지막 종료: ${lastExit.reason} (코드 ${lastExit.exitCode})`] : []),
    ...(waiting ? [waitingText(waiting)] : []),
  ]
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p>알림 근거: {facts.join(' · ')}</p>
      {logs.length > 0 && (
        <details>
          <summary className="cursor-pointer">로그 마지막 {logs.length}줄</summary>
          <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-bg p-2 font-mono text-xs whitespace-pre-wrap break-all">{logs.join('\n')}</pre>
        </details>
      )}
    </div>
  )
}

export default Evidence
