import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'

// loading: 저장된 세션을 아직 읽는 중. signedOut.expired: 로그인돼 있던 사용자가 로그아웃 버튼을 누르지 않았는데 세션이 끝났다.
export type AuthState =
  | { status: 'loading' }
  | { status: 'signedIn'; session: Session }
  | { status: 'signedOut'; expired: boolean }

export type AuthValue = {
  state: AuthState
  // 로그아웃에 실패하면 던진다. 서버에 닿지 못하면 세션이 그대로 남기 때문이다.
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthValue | null>(null)
