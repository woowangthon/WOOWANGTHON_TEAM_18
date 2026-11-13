import { Route, Routes } from 'react-router'
import RequireAdmin from './admin/RequireAdmin.tsx'
import AuthProvider from './auth/AuthProvider.tsx'
import RequireAuth from './auth/RequireAuth.tsx'
import StudentOnly from './auth/StudentOnly.tsx'
import AppLayout from './layout/AppLayout.tsx'
import AdminPage from './pages/AdminPage.tsx'
import DashboardPage from './pages/DashboardPage.tsx'
import DeployNewPage from './pages/DeployNewPage.tsx'
import DeployProgressPage from './pages/DeployProgressPage.tsx'
import DeploySecretsPage from './pages/DeploySecretsPage.tsx'
import DeploysPage from './pages/DeploysPage.tsx'
import LandingPage from './pages/LandingPage.tsx'
import LoginPage from './pages/LoginPage.tsx'
import ProfilePage from './pages/ProfilePage.tsx'
import ResetPasswordPage from './pages/ResetPasswordPage.tsx'
import SignupPage from './pages/SignupPage.tsx'

// `/`는 공개 랜딩이고, 로그인한 사용자는 LandingPage가 대시보드로 보낸다. 정의하지 않은 다른 경로는 아무것도 그리지 않는다. 404 화면은 아직 없다.
// 관리자는 학생 화면(대시보드 · 프로필 · 배포)을 열면 /admin으로 보낸다(편의일 뿐, 서버는 막지 않는다).
// /, /login, /signup, /reset-password는 공개이고 나머지는 로그인해야 열린다.
function App() {
  return (
    <AuthProvider>
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
