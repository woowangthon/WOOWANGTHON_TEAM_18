import type { Session } from '@supabase/supabase-js'
import ProfileSection from './ProfileSection.tsx'

const when = (iso: string | undefined) =>
  iso ? new Date(iso).toLocaleString('ko-KR') : '알 수 없음'

function AccountSection({ session }: { session: Session }) {
  const { user } = session
  const rows = [
    ['이메일', user.email],
    ['가입일', when(user.created_at)],
    ['마지막 로그인', when(user.last_sign_in_at)],
  ]
  return (
    <ProfileSection id="account" title="계정 정보">
      <dl className="flex flex-col gap-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-6">
            <dt className="text-muted sm:w-28 sm:flex-none">{label}</dt>
            <dd className="break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </ProfileSection>
  )
}

export default AccountSection
