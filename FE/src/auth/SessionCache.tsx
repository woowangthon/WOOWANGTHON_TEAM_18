import { useQueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useRef } from 'react'
import { useAuth } from './useAuth.ts'

// 기억해 둔 읽기 결과는 사용자의 것이다. 로그아웃하거나 다른 사용자로 바뀌면 모두 지워서 앞사람의 목록이 보이지 않게 한다.
// 로그아웃하면 보호된 화면이 곧 사라지므로(로그인 화면으로 간다) 화면이 지워진 값을 다시 읽으러 가는 일은 없다.
// useLayoutEffect: 자식 화면의 읽기가 시작되는 effect보다 먼저 지운다.
function SessionCache() {
  const { state } = useAuth()
  const queryClient = useQueryClient()
  const userId = state.status === 'signedIn' ? state.session.user.id : null
  const lastUserId = useRef<string | null>(null)
  const signedOut = state.status === 'signedOut'
  useLayoutEffect(() => {
    if (signedOut || (userId !== null && lastUserId.current !== null && userId !== lastUserId.current)) {
      queryClient.clear()
    }
    if (userId !== null) lastUserId.current = userId
    else if (signedOut) lastUserId.current = null
  }, [signedOut, userId, queryClient])
  return null
}

export default SessionCache
