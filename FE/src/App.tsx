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

// 운영자 화면과 배포 요청 · 진행 화면은 따로 받는다. 처음 여는 화면(랜딩 · 로그인 · 대시보드)의 내려받는 양을 줄인다.
// 로딩 중에는 AppLayout의 Suspense가 Skeleton을 보인다.
const AdminPage = lazy(() => import('./pages/AdminPage.tsx'))
const DeployNewPage = lazy(() => import('./pages/DeployNewPage.tsx'))
const DeployProgressPage = lazy(() => import('./pages/DeployProgressPage.tsx'))
const DeploySecretsPage = lazy(() => import('./pages/DeploySecretsPage.tsx'))

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
