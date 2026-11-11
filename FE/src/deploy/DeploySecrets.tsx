import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Alert } from '../components/ui/Alert.tsx'
import { Button } from '../components/ui/Button.tsx'
import { ApiError, apiFetch } from '../lib/api.ts'
import { failureOf } from '../pages/repo-failure.ts'
import SecretForm from './SecretForm.tsx'
import { secretsBodyOf, targetsOf } from './secrets.ts'
import type { SecretEntry, SecretsState } from './secrets.ts'

type Load = { status: 'loading' } | { status: 'ready'; secrets: SecretsState } | { status: 'not-found' } | { status: 'failed'; unavailable: boolean }

// 한 배포의 비밀값 입력(W3). 서버의 기록을 읽어 어느 서비스가 들어갔는지 보이고, 빠진 서비스의 값을 받아 보낸다.
// 값이 모두 들어가면(서버의 ready) "빌드 준비됨"을 보인다. 비밀값이 필요 없는 배포는 이 단계가 필요 없다고 알린다.
function DeploySecrets({ deployId }: { deployId: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const path = `/api/deploys/${deployId}/secrets`

  useEffect(() => {
    let ignore = false
    apiFetch<SecretsState>(path)
      .then((secrets) => {
        if (!ignore) setLoad({ status: 'ready', secrets })
      })
      .catch((error: unknown) => {
        if (ignore) return
        if (error instanceof ApiError && error.status === 404) setLoad({ status: 'not-found' })
        // 실패를 "아직 안 들어감"으로 바꾸지 않는다.
        else setLoad({ status: 'failed', unavailable: failureOf(error) === 'unavailable' })
      })
    return () => {
      ignore = true
    }
  }, [path, attempt])

  async function save(entries: SecretEntry[]) {
    try {
      const secrets = await apiFetch<SecretsState>(path, secretsBodyOf(entries), 'PUT')
      setLoad({ status: 'ready', secrets })
    } catch (error) {
      // 서비스를 차례로 쓰다 중간에 실패하면 앞의 서비스만 들어가 있다. 서버의 기록을 다시 읽어 보인다(읽기 실패는 무시한다).
      await apiFetch<SecretsState>(path)
        .then((secrets) => {
          setLoad({ status: 'ready', secrets })
        })
        .catch(() => undefined)
      throw error
    }
  }

  if (load.status === 'loading') {
    return (
      <p role="status" className="text-sm text-muted">
        비밀값 상태를 불러오는 중…
      </p>
    )
  }
  if (load.status === 'not-found') {
    return <Alert title="배포를 찾을 수 없어요">없는 배포이거나 내 배포가 아니에요.</Alert>
  }
  if (load.status === 'failed') {
    return (
      <Alert variant={load.unavailable ? 'warn' : 'err'} title="비밀값 상태를 읽지 못했어요">
        <div className="flex flex-col gap-2">
          <p>{load.unavailable ? '사용자 잘못이 아니에요. 잠시 뒤에 다시 시도해 주세요.' : '잠시 뒤에 다시 시도해 주세요.'}</p>
          <Button
            variant="outline"
            className="self-start"
            onClick={() => {
              setLoad({ status: 'loading' })
              setAttempt((count) => count + 1)
            }}
          >
            다시 읽기
          </Button>
        </div>
      </Alert>
    )
  }

  const { secrets } = load
  return (
    <div className="flex flex-col gap-4">
      {secrets.services.length === 0 ? (
        <Alert variant="info" title="비밀값이 필요 없는 배포예요">
          이 단계는 건너뛰어요.
        </Alert>
      ) : (
        <SecretForm services={targetsOf(secrets)} onSubmit={save} />
      )}
      {secrets.ready ? (
        <Alert variant="info" title="빌드 준비됨">
          <p>필요한 비밀값이 모두 들어갔어요. 이제 배포를 시작할 수 있어요.</p>
          <Link to={`/deploys/${deployId}`} className="mt-2 inline-block underline">
            배포 시작하러 가기
          </Link>
        </Alert>
      ) : (
        <p className="text-sm text-muted">모든 서비스의 비밀값이 들어가면 빌드가 준비돼요.</p>
      )}
    </div>
  )
}

export default DeploySecrets
