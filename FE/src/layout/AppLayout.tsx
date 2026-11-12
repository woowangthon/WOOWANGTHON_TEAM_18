import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { isAdmin } from '../auth/isAdmin.ts'
import { useAuth } from '../auth/useAuth.ts'
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
      <header className="border-b border-line bg-bg">
        <div className="mx-auto flex min-h-16 max-w-300 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 sm:px-8">
          <div className="flex flex-wrap items-stretch gap-x-8">
            <Link to="/dashboard" className="flex items-center py-2">
              {/* 임시: 로고 PNG가 흰 배경이라 다크에서는 밝은 칩 위에 올린다. 투명 배경 로고가 생기면 칩을 뺀다. */}
              <img
                src="/logo.png"
                alt="WCP"
                className="h-10 w-auto rounded-md dark:bg-fg dark:p-0.5"
              />
            </Link>
            <nav aria-label="주 메뉴" className="flex min-h-12 gap-1">
              <NavLink to="/dashboard" className={navLinkClass}>
                대시보드
              </NavLink>
              <NavLink to="/profile" className={navLinkClass}>
                프로필
              </NavLink>
              {/* 관리자는 모니터링 계정이라 배포 메뉴를 숨긴다(편의일 뿐, 서버는 막지 않는다). */}
              {!isAdmin(state.session) && (
                <NavLink to="/deploys" className={navLinkClass}>
                  내 배포
                </NavLink>
              )}
              {isAdmin(state.session) && (
                <NavLink to="/admin" className={navLinkClass}>
                  관리자
                </NavLink>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 py-2">
            <span className="text-xs text-muted">{state.session.user.email}</span>
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
