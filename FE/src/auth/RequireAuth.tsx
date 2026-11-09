import { Navigate, Outlet, useLocation } from 'react-router'
import type { LoginState } from './login-state.ts'
import { useAuth } from './useAuth.ts'

// 로그인해야 볼 수 있는 경로들을 감싸는 레이아웃 라우트.
function RequireAuth() {
  const { state } = useAuth()
  const location = useLocation()

  // 저장된 세션을 읽는 동안(거의 즉시)에는 로그인 화면으로 튕기지 않는다.
  if (state.status === 'loading') return null
  if (state.status === 'signedOut') {
    const loginState: LoginState = {
      from: location.pathname + location.search + location.hash,
      expired: state.expired,
    }
    return <Navigate to="/login" replace state={loginState} />
  }
  return <Outlet />
}

export default RequireAuth
