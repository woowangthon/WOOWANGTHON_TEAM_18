import { Navigate, Outlet } from 'react-router'
import { isAdmin } from './isAdmin.ts'
import { useAuth } from './useAuth.ts'

// 학생 화면을 감싸는 레이아웃 라우트. RequireAuth 안쪽에서만 쓴다. 관리자는 /admin으로 보낸다.
// 편의일 뿐이다. 서버는 막지 않는다.
function StudentOnly() {
  const { state } = useAuth()
  if (state.status !== 'signedIn') return null
  return isAdmin(state.session) ? <Navigate to="/admin" replace /> : <Outlet />
}

export default StudentOnly
