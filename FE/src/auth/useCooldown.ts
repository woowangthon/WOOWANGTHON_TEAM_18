import { useCallback, useEffect, useState } from 'react'

// 메일 재발송처럼 일정 시간 눌 수 없게 하는 카운트다운. remaining이 0이면 눌러도 된다.
// initialSeconds를 주면 화면이 뜨는 때부터 센다.
// 탭이 가려져 타이머가 늦게 돌아도 맞도록 틱 횟수가 아니라 끝나는 시각과 지금을 비교한다.
export function useCooldown(initialSeconds = 0) {
  const [clock, setClock] = useState(() => {
    const now = Date.now()
    return { now, until: now + initialSeconds * 1000 }
  })
  const remaining = Math.max(0, Math.ceil((clock.until - clock.now) / 1000))

  useEffect(() => {
    if (remaining <= 0) return
    const timer = setTimeout(() => {
      setClock((current) => ({ ...current, now: Date.now() }))
    }, 1000)
    return () => {
      clearTimeout(timer)
    }
  }, [remaining, clock.now])

  const start = useCallback((seconds: number) => {
    const now = Date.now()
    setClock({ now, until: now + seconds * 1000 })
  }, [])

  return { remaining, start }
}
