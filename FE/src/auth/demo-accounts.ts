// 시연 계정은 비밀번호를 바꿀 수 없다(영상 · 심사 중 로그인이 막히지 않게). 이 목록은 화면에서만 막는 편의다.
// 서버(Supabase)는 막지 않는다. 계정이 늘면 여기만 고친다(docs/ai-scope.md §3 `demo-accounts`).
const DEMO_ACCOUNTS = ['test@example.com', 'admin@example.com']

export const isDemoAccount = (email: string | undefined): boolean =>
  email !== undefined && DEMO_ACCOUNTS.includes(email.trim().toLowerCase())
