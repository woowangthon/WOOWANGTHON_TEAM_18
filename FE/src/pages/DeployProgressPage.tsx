import { Link, useParams } from 'react-router'
import DeployProgress from '../deploy/DeployProgress.tsx'

function DeployProgressPage() {
  const { id = '' } = useParams()
  return (
    <>
      <h1 className="text-xl">배포 진행 상태</h1>
      <DeployProgress deployId={id} />
      <Link to="/deploys" className="self-start text-sm underline">
        내 배포 목록
      </Link>
    </>
  )
}

export default DeployProgressPage
