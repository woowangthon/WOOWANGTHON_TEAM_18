import { Route, Routes } from 'react-router'
import AuthProvider from './auth/AuthProvider.tsx'
import RequireAuth from './auth/RequireAuth.tsx'
import AppLayout from './layout/AppLayout.tsx'
import DashboardPage from './pages/DashboardPage.tsx'
import DeployNewPage from './pages/DeployNewPage.tsx'
import DeployProgressPage from './pages/DeployProgressPage.tsx'
import DeploysPage from './pages/DeploysPage.tsx'
import LoginPage from './pages/LoginPage.tsx'
import ProfilePage from './pages/ProfilePage.tsx'
import ResetPasswordPage from './pages/ResetPasswordPage.tsx'
import SignupPage from './pages/SignupPage.tsx'

// 정의하지 않은 경로는 아무것도 그리지 않는다. `/` 이동과 404 화면은 아직 없다.
// /login, /signup, /reset-password는 공개이고 나머지는 로그인해야 열린다.
function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/deploy/new" element={<DeployNewPage />} />
            <Route path="/deploys" element={<DeploysPage />} />
            <Route path="/deploys/:id" element={<DeployProgressPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  )
}

export default App
