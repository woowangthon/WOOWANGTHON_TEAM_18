import { Link } from 'react-router'
import { isAdmin } from '../auth/isAdmin.ts'
import { useAuth } from '../auth/useAuth.ts'
import { Card } from '../components/ui/Card.tsx'
import { primaryLinkClass } from '../components/primaryLinkClass.ts'

// 로그인 뒤에 도착하는 곳. 프로젝트 목록은 아직 없어서(대시보드 이슈에서 채운다) 다음에 할 일만 안내한다.
function DashboardPage() {
  const { state } = useAuth()
  // 관리자는 모니터링 계정이라 배포 진입점을 숨긴다(편의일 뿐, 서버는 막지 않는다).
  const showDeployLink = !(state.status === 'signedIn' && isAdmin(state.session))
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl">대시보드</h1>
        <p className="text-muted">내 프로젝트를 한곳에서 봐요.</p>
      </div>
      {showDeployLink && (
        <Card className="flex flex-col items-start gap-3 p-6">
          <p className="font-bold">아직 보여 줄 프로젝트가 없어요</p>
          <p className="text-sm text-muted">레포를 정해 배포를 요청하면 여기에서 볼 수 있어요.</p>
          <Link
            to="/deploy/new"
            className={primaryLinkClass}
          >
            새 배포 요청하기
          </Link>
        </Card>
      )}
    </>
  )
}

export default DashboardPage
