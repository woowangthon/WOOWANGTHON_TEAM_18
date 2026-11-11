import type { Session } from '@supabase/supabase-js'

// 관리자는 토큰의 app_metadata.role이 'admin'일 때뿐이다(docs/design/auth.md). user_metadata는 사용자가 고칠 수 있어 쓰지 않는다.
// 화면에서 막는 것은 편의다. 진짜 판단은 서버가 하고, 서버가 403을 주면 화면도 "권한 없음"으로 보인다.
export function isAdmin(session: Session): boolean {
  return session.user.app_metadata.role === 'admin'
}
