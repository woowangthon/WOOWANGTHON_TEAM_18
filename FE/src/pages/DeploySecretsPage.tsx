import { useParams } from 'react-router'
import DeploySecrets from '../deploy/DeploySecrets.tsx'

function DeploySecretsPage() {
  const { id = '' } = useParams()
  return (
    <>
      <h1 className="text-xl">비밀값 입력</h1>
      {/* id가 바뀌면 이전 배포의 상태와 입력한 값이 남지 않도록 새로 그린다. */}
      <DeploySecrets key={id} deployId={id} />
    </>
  )
}

export default DeploySecretsPage
