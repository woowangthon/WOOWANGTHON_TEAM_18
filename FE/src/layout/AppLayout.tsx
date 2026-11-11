import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { isAdmin } from '../auth/isAdmin.ts'
import { useAuth } from '../auth/useAuth.ts'
import { Alert } from '../components/ui/Alert.tsx'
import { Button } from '../components/ui/Button.tsx'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'font-bold underline' : 'hover:underline'

// 로그인한 사용자의 화면 틀. RequireAuth 안쪽에서만 쓴다.
function AppLayout() {
  const { state, signOut } = useAuth()
  const { pathname } = useLocation()
  // 실패를 알린 화면을 기억해 두고, 다른 화면으로 가면 안내를 거둔다.
  const [signOutFailedAt, setSignOutFailedAt] = useState<string | null>(null)

  if (state.status !== 'signedIn') return null

  async function handleSignOut() {
    setSignOutFailedAt(null)
    try {
      await signOut()
    } catch {
      setSignOutFailedAt(pathname)
    }
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-4 py-2">
        <Link to="/dashboard" className="flex items-center">
          <img src="/favicon.svg" alt="WCP" className="h-12 w-12" />
        </Link>
        <nav aria-label="주 메뉴" className="flex gap-6 text-xl">
          <NavLink to="/dashboard" className={navLinkClass}>
            대시보드
          </NavLink>
          <NavLink to="/profile" className={navLinkClass}>
            프로필
          </NavLink>
          <NavLink to="/deploys" className={navLinkClass}>
            내 배포
          </NavLink>
          {isAdmin(state.session) && (
            <NavLink to="/admin" className={navLinkClass}>
              관리자
            </NavLink>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted">{state.session.user.email}</span>
          <Button
            variant="outline"
            onClick={() => {
              void handleSignOut()
            }}
          >
            로그아웃
          </Button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
        {signOutFailedAt === pathname && (
          <Alert title="로그아웃하지 못했어요">
            연결을 확인하고 다시 시도해 주세요.
          </Alert>
        )}
        <Outlet />
      </main>
    </>
  )
}

export default AppLayout
