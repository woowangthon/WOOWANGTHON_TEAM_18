import { Route, Routes } from 'react-router'
import DeployNewPage from './pages/DeployNewPage.tsx'
import LoginPage from './pages/LoginPage.tsx'
import ProfilePage from './pages/ProfilePage.tsx'
import ResetPasswordPage from './pages/ResetPasswordPage.tsx'
import SignupPage from './pages/SignupPage.tsx'

// 정의하지 않은 경로는 아무것도 그리지 않는다. `/` 이동과 404 화면은 아직 없다.
function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/deploy/new" element={<DeployNewPage />} />
    </Routes>
  )
}

export default App
