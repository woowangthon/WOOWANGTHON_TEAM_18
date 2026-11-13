import { Link } from 'react-router'
import { isAdmin } from '../auth/isAdmin.ts'
import { useAuth } from '../auth/useAuth.ts'
import { Card } from '../components/ui/Card.tsx'
import { primaryLinkClass } from '../components/primaryLinkClass.ts'

// 로그인 뒤에 도착하는 곳. 프로젝트 목록은 아직 없어서(대시보드 이슈에서 채운다) 데이터를 읽지 않고 다음에 할 일만 안내한다.
function DashboardPage() {
  const { state } = useAuth()
  // 관리자는 모니터링 계정이라 배포 진입점을 숨긴다(편의일 뿐, 서버는 막지 않는다).
  const showDeployLink = !(state.status === 'signedIn' && isAdmin(state.session))
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl">대시보드</h1>
        <p className="text-muted">배포를 요청하고 진행 상황을 확인해요.</p>
      </div>
      {showDeployLink && (
        <Card className="flex flex-col items-start gap-3 p-6">
          <p className="font-bold">다음 할 일</p>
          <p className="text-sm text-muted">
            배포를 요청하거나, 내 배포에서 진행 상황을 확인하세요.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link to="/deploy/new" className={primaryLinkClass}>
              새 배포 요청하기
            </Link>
            <Link to="/deploys" className="text-sm text-accent-text underline">
              내 배포 보기
            </Link>
          </div>
        </Card>
      )}
    </>
  )
}

export default DashboardPage
