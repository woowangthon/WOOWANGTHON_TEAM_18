import { useState } from 'react'

// 클립보드로 복사하고 결과를 알려 준다. 권한이 없거나 안전하지 않은 주소에서는 failed가 된다.
export function useCopy(text: string) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setState('done')
    } catch {
      setState('failed')
    }
  }
  return { state, copy }
}
