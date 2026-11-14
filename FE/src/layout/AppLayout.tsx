import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { isAdmin } from '../auth/isAdmin.ts'
import { useAuth } from '../auth/useAuth.ts'
import Logo from '../components/Logo.tsx'
import { Alert } from '../components/ui/Alert.tsx'
import { Button } from '../components/ui/Button.tsx'
import { tabClass } from '../components/ui/tabClass.ts'

// 활성 메뉴는 Tabs와 같은 모양(굵은 글씨 + accent-ui 밑줄)이고, 밑줄이 헤더 아래 선과 겹치도록 -mb-px다.
const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center self-stretch ${tabClass(isActive)}`

// 로그인한 사용자의 화면 틀. RequireAuth 안쪽에서만 쓴다.
function AppLayout() {
  const { state, signOut } = useAuth()
  const { pathname } = useLocation()
  // 실패를 알린 화면을 기억해 두고, 다른 화면으로 가면 안내를 거둔다.
  const [signOutFailedAt, setSignOutFailedAt] = useState<string | null>(null)

  if (state.status !== 'signedIn') return null
  const admin = isAdmin(state.session)

  async function handleSignOut() {
    setSignOutFailedAt(null)
    try {
      await signOut()
    } catch {
      setSignOutFailedAt(pathname)
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-bg">
        <div className="mx-auto flex min-h-16 max-w-300 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 sm:px-4">
          <div className="flex flex-wrap items-stretch gap-x-8 self-stretch">
            {/* 관리자는 /admin 안에서만 움직인다(편의일 뿐, 서버는 막지 않는다). 로고도 /admin으로 간다. */}
            <Link to={admin ? '/admin' : '/'} aria-label="WCP" className="flex items-center py-2">
              <Logo />
            </Link>
            <nav aria-label="주 메뉴" className="flex min-h-12 gap-1">
              {admin ? (
                <>
                  <NavLink to="/admin" end className={navLinkClass}>
                    관리자
                  </NavLink>
                  {/* 같은 화면 안의 구역으로 건너뛴다. */}
                  <a href="#운영알림" className={navLinkClass({ isActive: false })}>
                    운영 알림
                  </a>
                </>
              ) : (
                <>
                  <NavLink to="/dashboard" className={navLinkClass}>
                    대시보드
                  </NavLink>
                  <NavLink to="/deploys" className={navLinkClass}>
                    내 배포
                  </NavLink>
                </>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 py-2">
            <span className="hidden text-xs text-muted sm:inline">{state.session.user.email}</span>
            {!admin && (
              <NavLink to="/profile" className={navLinkClass}>
                프로필
              </NavLink>
            )}
            <Button
              variant="outline"
              onClick={() => {
                void handleSignOut()
              }}
            >
              로그아웃
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-300 flex-1 flex-col gap-6 px-3 py-8 sm:px-4">
        {signOutFailedAt === pathname && (
          <Alert title="로그아웃하지 못했어요">
            연결을 확인하고 다시 시도해 주세요.
          </Alert>
        )}
        <Outlet />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-300 items-center gap-3 px-3 py-4 text-sm text-muted sm:px-4">
          <Logo className="size-6" />
          <span>2026 AI 우왕톤 · 왕가네식구들</span>
        </div>
      </footer>
    </div>
  )
}

export default AppLayout
