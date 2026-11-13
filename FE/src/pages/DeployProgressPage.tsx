import { Link, useParams } from 'react-router'
import DeployProgress from '../deploy/DeployProgress.tsx'

function DeployProgressPage() {
  const { id = '' } = useParams()
  return (
    <>
      <h1 className="text-xl">배포 진행 상태</h1>
      {/* id가 바뀌면 이전 배포의 상태 · 시작 버튼이 남지 않도록 새로 그린다. */}
      <DeployProgress key={id} deployId={id} />
      <Link to="/deploys" className="self-start text-sm text-accent-text underline">
        내 배포 목록
      </Link>
    </>
  )
}

export default DeployProgressPage
