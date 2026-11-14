import { useAuth } from '../auth/useAuth.ts'
import AccountSection from '../profile/AccountSection.tsx'
import DiscordSection from '../profile/DiscordSection.tsx'
import DeploySummarySection from '../profile/DeploySummarySection.tsx'
import PasswordSection from '../profile/PasswordSection.tsx'
import GithubLinkCard from './GithubLinkCard.tsx'

const sections = [
  { id: 'account', label: '계정 정보' },
  { id: 'password', label: '비밀번호 변경' },
  { id: 'github', label: 'GitHub 연동' },
  { id: 'discord', label: 'Discord 알림' },
  { id: 'deploys', label: '내 배포 요약' },
]

function ProfilePage() {
  const { state } = useAuth()
  if (state.status !== 'signedIn') return null
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl">프로필</h1>
        <p className="text-muted">계정과 GitHub 연동, 내 배포를 관리해요.</p>
      </div>
      <nav aria-label="프로필 구역" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {sections.map(({ id, label }) => (
          <a key={id} href={`#${id}`} className="text-accent-text underline">
            {label}
          </a>
        ))}
      </nav>
      <AccountSection session={state.session} />
      <PasswordSection email={state.session.user.email ?? ''} />
      <section id="github" aria-labelledby="github-heading" className="flex scroll-mt-4 flex-col gap-3">
        <h2 id="github-heading" className="text-lg">
          GitHub 연동
        </h2>
        <GithubLinkCard />
      </section>
      <DiscordSection />
      <DeploySummarySection />
    </>
  )
}

export default ProfilePage
