import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Alert } from '../components/ui/Alert.tsx'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { ApiError, apiFetch } from '../lib/api.ts'
import DeployStages from './DeployStages.tsx'
import { isActive, isPlatformProblem, POLL_MS, stageStatesOf, statusLabel, statusVariant } from './progress.ts'
import type { Progress } from './progress.ts'
import { STAGES } from './stages.ts'

type Load = { status: 'loading' } | { status: 'ready'; progress: Progress } | { status: 'not-found' }
type StartFailure = 'not-ready' | 'in-progress' | 'unavailable' | 'not-found' | 'failed'

// 이미 시작한 배포(ALREADY_STARTED)는 오류로 보이지 않는다. 곧바로 다시 읽는 상태가 그 사실을 보여 준다.
function startFailureOf(error: unknown): StartFailure | null {
  if (!(error instanceof ApiError)) return 'failed'
  if (error.code === 'ALREADY_STARTED') return null
  if (error.code === 'NOT_READY') return 'not-ready'
  if (error.code === 'DEPLOY_IN_PROGRESS') return 'in-progress'
  if (error.code === 'DEPLOY_NOT_FOUND') return 'not-found'
  return error.status === 503 || error.code === 'NETWORK_ERROR' ? 'unavailable' : 'failed'
}

function StartFailureAlert({ failure }: { failure: StartFailure }) {
  switch (failure) {
    case 'not-ready':
      return (
        <Alert variant="warn" title="아직 시작할 수 없어요">
          배포 준비가 끝나지 않았어요. 비밀값이 모두 들어갔는지 확인한 뒤 다시 시작해 주세요.
        </Alert>
      )
    case 'in-progress':
      return (
        <Alert variant="warn" title="같은 프로젝트의 배포가 진행 중이에요">
          그 배포가 끝난 뒤에 다시 시작해 주세요.
        </Alert>
      )
    case 'not-found':
      return <Alert title="배포를 찾을 수 없어요">없는 배포이거나 내 배포가 아니에요.</Alert>
    case 'unavailable':
      return (
        <Alert variant="warn" title="지금은 배포를 시작할 수 없어요">
          사용자 잘못이 아니에요. 잠시 뒤에 다시 시도해 주세요. 시작되지 않았다면 아무것도 바뀌지 않았어요.
        </Alert>
      )
    case 'failed':
      return <Alert title="배포를 시작하지 못했어요">잠시 뒤에 다시 시도해 주세요.</Alert>
  }
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
  }
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          void copy()
        }}
      >
        주소 복사
      </Button>
      {state === 'copied' && <span role="status" className="text-sm">복사했어요</span>}
      {state === 'failed' && (
        <span role="status" className="text-sm">
          복사하지 못했어요. 주소를 직접 선택해 복사해 주세요.
        </span>
      )}
    </>
  )
}

const stageLabelOf = (key: string) => STAGES.find((stage) => stage.key === key)?.label

// 한 배포의 진행 상태. 진행 중일 때만 3초마다 다시 읽고, 화면을 떠나면 멈춘다.
function DeployProgress({ deployId }: { deployId: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  // 마지막 읽기가 실패했는지. 실패해도 지금 보이는 상태는 지우지 않고 계속 다시 시도한다.
  const [offline, setOffline] = useState(false)
  const [reads, setReads] = useState(0)
  const [starting, setStarting] = useState(false)
  const [startFailure, setStartFailure] = useState<StartFailure | null>(null)

  useEffect(() => {
    let ignore = false
    let timer: ReturnType<typeof setTimeout> | undefined
    async function read() {
      let again = true
      try {
        const progress = await apiFetch<Progress>(`/api/deploys/${deployId}/status`)
        if (ignore) return
        setLoad({ status: 'ready', progress })
        setOffline(false)
        again = isActive(progress.status)
      } catch (error) {
        if (ignore) return
        if (error instanceof ApiError && error.status === 404) {
          setLoad({ status: 'not-found' })
          again = false
        } else {
          setOffline(true)
        }
      }
      if (again) timer = setTimeout(() => void read(), POLL_MS)
    }
    void read()
    return () => {
      ignore = true
      clearTimeout(timer)
    }
  }, [deployId, reads])

  async function start() {
    setStarting(true)
    setStartFailure(null)
    try {
      // 계약은 본문 없는 POST지만 apiFetch는 본문이 있어야 POST로 보낸다. 빈 객체를 보낸다.
      await apiFetch(`/api/deploys/${deployId}/start`, {})
    } catch (error) {
      setStartFailure(startFailureOf(error))
    } finally {
      setStarting(false)
      // 성공이든 실패든 서버가 아는 상태를 다시 읽는다(저장됐는지 알 수 없는 실패도 있다).
      setReads((count) => count + 1)
    }
  }

  if (load.status === 'not-found') {
    return (
      <Alert title="배포를 찾을 수 없어요">
        없는 배포이거나 내 배포가 아니에요. <Link to="/deploys" className="underline">내 배포 목록으로 가기</Link>
      </Alert>
    )
  }

  const offlineNotice = offline && (
    <Alert variant="warn" title="서버와 연결하지 못했어요">
      사용자 잘못이 아니에요. 자동으로 다시 시도하고 있어요.
    </Alert>
  )

  if (load.status === 'loading') {
    return (
      <>
        {offlineNotice}
        <p role="status" className="text-sm text-muted">
          진행 상태를 불러오는 중…
        </p>
      </>
    )
  }

  const { progress } = load
  const failure = progress.failure
  return (
    <section aria-label="배포 진행 상태" className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Badge variant={statusVariant(progress.status)}>{statusLabel(progress.status)}</Badge>
        {isActive(progress.status) && <span className="text-sm text-muted">3초마다 새로 읽고 있어요</span>}
      </div>
      {offlineNotice}
      <DeployStages states={stageStatesOf(progress)} />

      {progress.status === 'not_started' && (
        <div className="flex flex-col gap-2">
          {startFailure && <StartFailureAlert failure={startFailure} />}
          <Button className="self-start" onClick={() => void start()} disabled={starting} aria-busy={starting}>
            {starting ? '시작하는 중…' : '배포 시작'}
          </Button>
        </div>
      )}

      {progress.status === 'fixing' && (
        <Alert variant="info" title="문제를 해결하는 중이에요">
          {failure?.message}
        </Alert>
      )}
      {progress.status === 'needs_user' && (
        <Alert variant="warn" title="사용자 조치가 필요해요">
          {failure?.message}
        </Alert>
      )}
      {progress.status === 'failed' && (
        <Alert title="배포하지 못했어요">
          <div className="flex flex-col gap-1">
            {failure && (
              <>
                <p>{failure.message}</p>
                <p className="text-muted">
                  단계: {stageLabelOf(failure.stage) ?? failure.stage}
                  {failure.service ? ` · 서비스: ${failure.service}` : ''}
                </p>
                {isPlatformProblem(failure.code) && (
                  <p>플랫폼 쪽 문제예요. 학생 잘못이 아니에요. 잠시 뒤에 새로 배포해 보고, 계속되면 운영자에게 알려 주세요.</p>
                )}
              </>
            )}
          </div>
        </Alert>
      )}

      {progress.status === 'succeeded' && progress.url?.startsWith('https://') && (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg">배포가 끝났어요</h2>
          <div className="flex flex-wrap items-center gap-2">
            <a href={progress.url} target="_blank" rel="noopener noreferrer" className="font-mono underline">
              {progress.url}
            </a>
            <CopyButton text={progress.url} />
          </div>
        </div>
      )}
    </section>
  )
}

export default DeployProgress
