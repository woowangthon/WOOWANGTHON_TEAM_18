import { useCallback, useEffect, useState } from 'react'

// 메일 재발송처럼 일정 시간 눌 수 없게 하는 카운트다운. remaining이 0이면 눌러도 된다.
export function useCooldown() {
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    if (remaining <= 0) return
    const timer = setTimeout(() => {
      setRemaining((seconds) => seconds - 1)
    }, 1000)
    return () => {
      clearTimeout(timer)
    }
  }, [remaining])

  const start = useCallback((seconds: number) => {
    setRemaining(seconds)
  }, [])

  return { remaining, start }
}
