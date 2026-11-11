import { useState } from 'react'
import { Button } from '../components/ui/Button.tsx'

// 배포할 commit. 보이는 글자는 앞 7자리이고 복사하면 전체 SHA(40자)가 간다.
function CommitRef({ commit }: { commit: string }) {
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle')

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(commit)
      setCopy('done')
    } catch {
      // 권한이 없거나 안전하지 않은 주소에서는 복사할 수 없다. 전체 값을 title로 남긴다.
      setCopy('failed')
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <code className="font-mono text-sm" title={commit}>
        {commit.slice(0, 7)}
      </code>
      <Button
        variant="outline"
        aria-label="commit 전체 해시 복사"
        onClick={() => {
          void handleCopy()
        }}
      >
        복사
      </Button>
      {copy === 'done' && <span role="status" className="text-sm text-muted">복사했어요</span>}
      {copy === 'failed' && (
        <span role="status" className="text-sm text-muted">
          복사하지 못했어요. 전체 해시: <code className="font-mono">{commit}</code>
        </span>
      )}
    </span>
  )
}

export default CommitRef
