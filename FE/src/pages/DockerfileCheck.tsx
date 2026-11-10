import { useEffect, useState } from 'react'
import { Alert } from '../components/ui/Alert.tsx'
import { Button } from '../components/ui/Button.tsx'
import { apiFetch } from '../lib/api.ts'
import RepoFailureAlert from './RepoFailureAlert.tsx'
import { failureOf, isRetryable } from './repo-failure.ts'
import type { Failure } from './repo-failure.ts'

type DockerfilesResult = { repo: string; dockerfiles: string[]; truncated: boolean }
type CheckState =
  | { status: 'loading' }
  | { status: 'failed'; failure: Failure }
  | { status: 'done'; dockerfiles: string[]; truncated: boolean }

// 레포 확인(#57)을 통과한 주소의 Dockerfile 경로를 찾는다. 없을 때 무엇을 할지는 아직 정해지지 않아(#25) 사실만 보인다.
function DockerfileCheck({ repoUrl }: { repoUrl: string }) {
  const [state, setState] = useState<CheckState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let ignore = false
    apiFetch<DockerfilesResult>('/api/repos/dockerfiles', { repoUrl })
      .then(({ dockerfiles, truncated }) => {
        if (!ignore) setState({ status: 'done', dockerfiles, truncated })
      })
      .catch((error: unknown) => {
        // 실패를 "Dockerfile 없음"으로 바꾸지 않는다(F-1). 로그인 만료는 apiFetch가 로그아웃시킨다.
        if (!ignore) setState({ status: 'failed', failure: failureOf(error) })
      })
    return () => {
      ignore = true
    }
  }, [repoUrl, attempt])

  return (
    <section aria-labelledby="dockerfile-heading" className="flex flex-col gap-3">
      <h2 id="dockerfile-heading" className="text-lg">
        Dockerfile
      </h2>

      {state.status === 'loading' && (
        <p role="status" className="text-sm text-muted">
          Dockerfile을 확인하는 중…
        </p>
      )}

      {state.status === 'failed' && (
        <div className="flex flex-col items-start gap-3">
          {isRetryable(state.failure) ? (
            <>
              <RepoFailureAlert failure={state.failure} title="Dockerfile을 확인하지 못했어요" />
              <Button
                variant="outline"
                onClick={() => {
                  setState({ status: 'loading' })
                  setAttempt((n) => n + 1)
                }}
              >
                다시 확인하기
              </Button>
            </>
          ) : (
            // 소유 확인을 다시 통과하지 못한 경우(연동을 풀었거나 레포가 바뀜). 다시 시도해도 같은 결과다.
            <RepoFailureAlert failure={state.failure} />
          )}
        </div>
      )}

      {state.status === 'done' && (
        <>
          {state.dockerfiles.length > 0 && (
            <ul className="flex flex-col gap-1 font-mono text-sm">
              {state.dockerfiles.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          )}
          {state.dockerfiles.length === 0 && !state.truncated && (
            <p className="text-sm">Dockerfile이 없어요.</p>
          )}
          {state.truncated && (
            <Alert variant="warn" title="레포가 커서 일부만 확인했어요">
              {state.dockerfiles.length > 0
                ? '찾은 Dockerfile이 전부가 아닐 수 있어요.'
                : 'Dockerfile이 없다고 말할 수 없어요.'}
            </Alert>
          )}
        </>
      )}
    </section>
  )
}

export default DockerfileCheck
