import { Outlet } from 'react-router'
import { isAdmin } from '../auth/isAdmin.ts'
import { useAuth } from '../auth/useAuth.ts'
import ForbiddenNotice from './ForbiddenNotice.tsx'

// 관리자 전용 경로를 감싸는 레이아웃 라우트. RequireAuth 안쪽에서만 쓴다(로그인 여부는 거기서 본다).
function RequireAdmin() {
  const { state } = useAuth()
  if (state.status !== 'signedIn') return null
  return isAdmin(state.session) ? <Outlet /> : <ForbiddenNotice />
}

export default RequireAdmin
