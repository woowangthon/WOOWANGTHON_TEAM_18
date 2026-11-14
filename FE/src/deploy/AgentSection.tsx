import { Link } from 'react-router'
import { Card } from '../components/ui/Card.tsx'
import type { AgentResult } from './progress.ts'

// 모르는 status는 결과를 냈다고만 말한다(그리지 못하는 값이 없게).
const resultLabel = (status: string) => {
  switch (status) {
    case 'verified':
      return '고쳐서 다시 배포했어요'
    case 'pr_opened':
      return '수정 PR을 열었어요'
    case 'needs_user':
      return '내가 할 일이 있어요'
    case 'gave_up':
      return '해결하지 못했어요'
    default:
      return '결과를 냈어요'
  }
}

// AI 동료가 이 배포에 낸 해결 결과. 무엇을 했는지(summary)와 학생이 할 일(userRequest)을 보인다.
// 값은 서버가 외부 전송 필터를 거친 것이라 그대로 보여 줘도 된다.
function AgentSection({ agent, deployId }: { agent: AgentResult; deployId: string }) {
  const { status, summary, userRequest, prUrl, evidence } = agent
  const items = evidence.filter((item) => item.ref || item.text)
  return (
    <Card role="region" aria-label="AI 동료" className="flex flex-col gap-3">
      <h2 className="text-lg">AI 동료</h2>
      <p className="font-bold">{resultLabel(status)}</p>
      <p>{summary}</p>
      {prUrl?.startsWith('https://') && (
        <a href={prUrl} target="_blank" rel="noopener noreferrer" className="self-start break-all text-accent-text underline">
          수정 PR 보러 가기
        </a>
      )}
      {status === 'pr_opened' && prUrl?.startsWith('https://') && (
        <div className="flex flex-col gap-2">
          <p className="font-bold">다음에 할 일</p>
          <ol className="list-decimal pl-5">
            <li>수정 PR을 열어 바뀐 내용을 확인해요.</li>
            <li>GitHub에서 PR을 머지해요.</li>
            <li>머지한 뒤 다시 배포해요. 가장 새 commit으로 배포돼요.</li>
          </ol>
          <Link to={`/deploy/new?from=${deployId}`} className="self-start text-accent-text underline">
            다시 배포
          </Link>
        </div>
      )}
      {userRequest && (
        <div className="flex flex-col gap-2">
          <p className="font-bold">내가 할 일</p>
          <p>{userRequest.message}</p>
          {userRequest.secretKeys.length > 0 && (
            <>
              {/* 이 배포에는 비밀값을 다시 넣어 이어 갈 방법이 없다(이미 시작한 배포라 시작도 안 된다). 새 배포에서 넣게 한다. */}
              <p>아래 비밀값을 준비한 뒤 새 배포를 요청해 주세요. 새 배포의 비밀값 단계에서 넣으면 돼요.</p>
              <ul className="font-mono">
                {userRequest.secretKeys.map((key) => (
                  <li key={key}>{key}</li>
                ))}
              </ul>
              <Link to="/deploy/new" className="self-start text-accent-text underline">
                새 배포 요청하기
              </Link>
            </>
          )}
        </div>
      )}
      {items.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-muted">근거</p>
          <ul className="list-disc pl-5">
            {items.map((item, index) => (
              <li key={index}>
                {item.ref && <span className="font-mono">{item.ref}</span>}
                {item.ref && item.text ? ' — ' : ''}
                {item.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

export default AgentSection
