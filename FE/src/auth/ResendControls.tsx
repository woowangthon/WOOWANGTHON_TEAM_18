import { useState } from 'react'
import { Button } from '../components/ui/Button.tsx'
import { mailFailureCopy } from './mail-error.ts'
import type { MailFailure } from './mail-error.ts'
import { useCooldown } from './useCooldown.ts'

const RESEND_COOLDOWN_SECONDS = 60

type Props = {
  send: () => Promise<MailFailure | 'ok'>
  label: string
  sentText: string
  onChangeAddress: () => void
}

// "메일을 확인해 주세요" 화면의 아래쪽: 다시 보내기(첫 발송 직후 60초 잠금) · 결과 안내 · 주소 바꾸기.
// 화면이 뜰 때 만들어지고 주소를 바꾸러 가면 사라지므로, 다시 오면 처음 상태에서 시작한다.
function ResendControls({ send, label, sentText, onChangeAddress }: Props) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [failure, setFailure] = useState<MailFailure | null>(null)
  const cooldown = useCooldown(RESEND_COOLDOWN_SECONDS)

  async function handleResend() {
    setStatus('sending')
    setFailure(null)
    const result = await send()
    if (result === 'ok') setStatus('sent')
    else {
      setStatus('idle')
      setFailure(result)
    }
    // 보냈든 한도에 걸렸든 바로 다시 누르게 두지 않는다.
    if (result === 'ok' || result === 'rate') cooldown.start(RESEND_COOLDOWN_SECONDS)
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        onClick={() => {
          void handleResend()
        }}
        disabled={status === 'sending' || cooldown.remaining > 0}
        className="w-full"
      >
        {cooldown.remaining > 0 ? `${label} (${cooldown.remaining}초 뒤)` : label}
      </Button>
      {status === 'sent' && (
        <p role="status" className="text-sm">
          {sentText}
        </p>
      )}
      {failure && (
        <p role="status" className="text-sm">
          {mailFailureCopy[failure].title}. {mailFailureCopy[failure].body}
        </p>
      )}
      <Button variant="outline" onClick={onChangeAddress} className="w-full">
        이메일 주소 바꾸기
      </Button>
    </div>
  )
}

export default ResendControls
