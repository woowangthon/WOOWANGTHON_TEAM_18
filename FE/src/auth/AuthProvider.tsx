import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase.ts'
import { AuthContext } from './auth-context.ts'
import type { AuthState, AuthValue } from './auth-context.ts'

// 구독 직후 INITIAL_SESSION이 와서 저장된 세션이 복원되므로 getSession을 따로 부르지 않는다.
function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  // 로그아웃 버튼으로 끝낸 세션과, API 401 · 토큰 갱신 실패 · 다른 탭에서 끝난 세션을 가른다.
  const manualSignOut = useRef(false)

  useEffect(() => {
    // 콜백 안에서는 상태만 바꾼다. 여기서 supabase를 다시 부르면 교착될 수 있다.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setState({ status: 'signedIn', session })
        return
      }
      // 업데이터는 렌더 때 실행되는데 그때는 signOut이 끝나 표시가 지워져 있을 수 있다. 이벤트 시점에 읽어 둔다.
      const byLogoutButton = manualSignOut.current
      setState((current) =>
        current.status === 'signedOut'
          ? current
          : {
              status: 'signedOut',
              expired: current.status === 'signedIn' && !byLogoutButton,
            },
      )
    })
    return () => {
      data.subscription.unsubscribe()
    }
  }, [])

  const signOut = useCallback(async () => {
    manualSignOut.current = true
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    } finally {
      manualSignOut.current = false
    }
  }, [])

  const value = useMemo<AuthValue>(() => ({ state, signOut }), [state, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export default AuthProvider
