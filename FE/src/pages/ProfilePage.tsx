import GithubLinkCard from './GithubLinkCard.tsx'

function ProfilePage() {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl">프로필</h1>
        <p className="text-muted">GitHub 연동을 관리해요.</p>
      </div>
      <GithubLinkCard />
    </>
  )
}

export default ProfilePage
