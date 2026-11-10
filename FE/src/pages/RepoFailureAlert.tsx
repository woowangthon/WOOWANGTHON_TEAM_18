import { Link } from 'react-router'
import { Alert } from '../components/ui/Alert.tsx'
import { failureCopy } from './repo-failure.ts'
import type { Failure } from './repo-failure.ts'

// title은 이 오류를 보여 주는 화면이 제목을 자기 말로 바꾸고 싶을 때만 넘긴다.
function RepoFailureAlert({ failure, title }: { failure: Failure; title?: string }) {
  const { title: defaultTitle, body } = failureCopy[failure]
  return (
    <Alert title={title ?? defaultTitle}>
      <div className="flex flex-col gap-2">
        <p>{body}</p>
        {failure === 'not-linked' && (
          <Link to="/profile" className="font-bold underline">
            프로필로 이동
          </Link>
        )}
      </div>
    </Alert>
  )
}

export default RepoFailureAlert
