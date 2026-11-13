import { lazy } from 'react'
import { Route, Routes } from 'react-router'
import RequireAdmin from './admin/RequireAdmin.tsx'
import AuthProvider from './auth/AuthProvider.tsx'
import RequireAuth from './auth/RequireAuth.tsx'
import SessionCache from './auth/SessionCache.tsx'
import StudentOnly from './auth/StudentOnly.tsx'
import AppLayout from './layout/AppLayout.tsx'
import DashboardPage from './pages/DashboardPage.tsx'
import DeploysPage from './pages/DeploysPage.tsx'
import LandingPage from './pages/LandingPage.tsx'
import LoginPage from './pages/LoginPage.tsx'
import ProfilePage from './pages/ProfilePage.tsx'
import ResetPasswordPage from './pages/ResetPasswordPage.tsx'
import SignupPage from './pages/SignupPage.tsx'
import DeployNewPage from './pages/DeployNewPage.tsx'
import DeployProgressPage from './pages/DeployProgressPage.tsx'
import DeploySecretsPage from './pages/DeploySecretsPage.tsx'

// 운영자 화면만 따로 받는다. 학생 화면(배포 요청 · 진행 · 비밀값)은 작아서(합계 gzip 약 16kB) 나누지 않는다:
// 나누면 처음 열 때마다 Suspense가 Skeleton을 보인 뒤 최소 300ms를 붙들어 화면이 그만큼 늦게 뜬다(미리 받아도 같다).
// 로딩 중에는 AppLayout의 Suspense가 Skeleton을 보인다.
const AdminPage = lazy(() => import('./pages/AdminPage.tsx'))

// `/`는 공개 랜딩이다. 로그인한 사용자에게는 랜딩이 "대시보드로" 링크를 보인다(자동으로 보내지 않는다). 정의하지 않은 다른 경로는 아무것도 그리지 않는다. 404 화면은 아직 없다.
// 관리자는 학생 화면(대시보드 · 프로필 · 배포)을 열면 /admin으로 보낸다(편의일 뿐, 서버는 막지 않는다).
// /, /login, /signup, /reset-password는 공개이고 나머지는 로그인해야 열린다.
function App() {
  return (
    <AuthProvider>
      <SessionCache />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route element={<StudentOnly />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/deploy/new" element={<DeployNewPage />} />
              <Route path="/deploys" element={<DeploysPage />} />
              <Route path="/deploys/:id" element={<DeployProgressPage />} />
              <Route path="/deploys/:id/secrets" element={<DeploySecretsPage />} />
            </Route>
            <Route element={<RequireAdmin />}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  )
}

export default App
