import type { ReactNode } from 'react'
import { Link } from 'react-router'

// 로그인 · 가입 · 비밀번호 재설정이 같이 쓰는 화면 틀: 로고만 있는 상단 바와 한가운데 카드(최대 440px).
function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-bg">
        <div className="mx-auto flex h-16 max-w-300 items-center px-4 sm:px-8">
          <Link to="/" className="flex items-center">
            {/* 임시: 로고가 흰 배경이라 다크에서는 밝은 칩 위에 올린다. 투명 배경 로고가 생기면 칩을 뺀다. */}
            <img
              src="/logo.svg"
              alt="WCP"
              className="size-10 rounded-md object-contain dark:bg-fg dark:p-0.5"
            />
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
        <div className="flex w-full max-w-110 flex-col gap-6 rounded-md border border-line bg-bg p-6 sm:p-8">
          {children}
        </div>
      </main>
    </div>
  )
}

export default AuthCard
