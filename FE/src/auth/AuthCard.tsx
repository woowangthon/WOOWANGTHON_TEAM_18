import type { ReactNode } from 'react'
import { Card } from '../components/ui/Card.tsx'

// 로그인 · 가입 · 비밀번호 재설정이 같이 쓰는 한가운데 카드.
function AuthCard({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md">
        <div className="flex flex-col gap-6 p-4">{children}</div>
      </Card>
    </main>
  )
}

export default AuthCard
