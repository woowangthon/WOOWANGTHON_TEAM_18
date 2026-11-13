import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Alert } from '../components/ui/Alert.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Card } from '../components/ui/Card.tsx'
import { CheckIcon } from '../components/ui/Icons.tsx'
import { Spinner } from '../components/ui/Spinner.tsx'
import { ApiError, apiFetch } from '../lib/api.ts'
import DeployStages from './DeployStages.tsx'
import { isActive, isPlatformProblem, POLL_MS, stageStatesOf } from './progress.ts'
import type { Progress } from './progress.ts'
import StatusBadge from './StatusBadge.tsx'
import { STAGES } from './stages.ts'
import { useCopy } from './useCopy.ts'

type Load = { status: 'loading' } | { status: 'ready'; progress: Progress } | { status: 'not-found' }
type StartFailureKind = 'not-ready' | 'in-progress' | 'unavailable' | 'not-found' | 'failed'
// missing: NOT_READY가 알려 준 빠진 항목의 이름(fields의 path). 서버가 알려 주지 않으면 비어 있다.
type StartFailure = { kind: StartFailureKind; missing: string[] }

// 빠진 비밀값은 `secrets.<서비스>.<KEY>`로 오므로 `<서비스> · <KEY>`로 보이고, 그 밖의 항목은 path를 그대로 보인다.
function missingName(path: string) {
  const [root, service, key, ...rest] = path.split('.')
  return root === 'secrets' && service && key && rest.length === 0 ? `${service} · ${key}` : path
}

// 이미 시작한 배포(ALREADY_STARTED)는 오류로 보이지 않는다. 곧바로 다시 읽는 상태가 그 사실을 보여 준다.
function startFailureOf(error: unknown): StartFailure | null {
  const failure = (kind: StartFailureKind, missing: string[] = []): StartFailure => ({ kind, missing })
  if (!(error instanceof ApiError)) return failure('failed')
  if (error.code === 'ALREADY_STARTED') return null
  if (error.code === 'NOT_READY') return failure('not-ready', error.fields.map((field) => missingName(field.path)))
  if (error.code === 'DEPLOY_IN_PROGRESS') return failure('in-progress')
  if (error.code === 'DEPLOY_NOT_FOUND') return failure('not-found')
  return failure(error.status === 503 || error.code === 'NETWORK_ERROR' ? 'unavailable' : 'failed')
}

function StartFailureAlert({ failure: { kind, missing } }: { failure: StartFailure }) {
  switch (kind) {
    case 'not-ready':
      return (
        <Alert variant="warn" title="아직 시작할 수 없어요">
          <div className="flex flex-col gap-1">
            <p>배포 준비가 끝나지 않았어요. 비밀값이 모두 들어갔는지 확인한 뒤 다시 시작해 주세요.</p>
            {missing.length > 0 && (
              <>
                <p>빠진 항목</p>
                <ul className="font-mono">
                  {missing.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
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
  const { state, copy } = useCopy(text)
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
      {state === 'done' && <span role="status" className="text-sm">복사했어요</span>}
      {state === 'failed' && (
        <span role="status" className="text-sm">
          복사하지 못했어요. 주소를 직접 선택해 복사해 주세요.
        </span>
      )}
    </>
  )
}

// failure.stage는 파이프라인 스테이지(build · prepare · render · apply · verify · switch)라 단계 이름과 다르다.
// 계약은 실패한 스테이지가 속한 단계를 failed로 준다고 하므로, 그 단계의 이름을 쓰고 없으면 받은 값을 그대로 보인다.
const failedStageLabel = ({ steps, failure }: Progress) => {
  const key = steps.find((step) => step.state === 'failed')?.key
  return STAGES.find((stage) => stage.key === key)?.label ?? failure?.stage
}

// 한 배포의 진행 상태. 진행 중일 때만 3초마다 다시 읽고, 화면을 떠나면 멈춘다.
function DeployProgress({ deployId }: { deployId: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  // 마지막 읽기가 실패했는지. 실패해도 지금 보이는 상태는 지우지 않는다.
  // retrying: 서버 장애나 네트워크 문제라 계속 다시 시도한다. stopped: 다시 시도해도 나아지지 않을 오류라 멈추고 사용자가 다시 읽게 한다.
  const [offline, setOffline] = useState<'retrying' | 'stopped' | null>(null)
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
        setOffline(null)
        again = isActive(progress.status)
      } catch (error) {
        if (ignore) return
        if (error instanceof ApiError && error.status === 404) {
          setLoad({ status: 'not-found' })
          again = false
        } else {
          const retryable = error instanceof ApiError && (error.status === 503 || error.code === 'NETWORK_ERROR')
          setOffline(retryable ? 'retrying' : 'stopped')
          again = retryable
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
        없는 배포이거나 내 배포가 아니에요. <Link to="/deploys" className="text-accent-text underline">내 배포 목록으로 가기</Link>
      </Alert>
    )
  }

  const offlineNotice =
    offline === 'retrying' ? (
      <Alert variant="warn" title="서버와 연결하지 못했어요">
        사용자 잘못이 아니에요. 자동으로 다시 시도하고 있어요.
      </Alert>
    ) : offline === 'stopped' ? (
      <Alert title="진행 상태를 읽지 못했어요">
        <div className="flex flex-col gap-2">
          <p>잠시 뒤에 다시 읽어 주세요.</p>
          <Button
            variant="outline"
            className="self-start"
            onClick={() => {
              setOffline(null)
              setReads((count) => count + 1)
            }}
          >
            다시 읽기
          </Button>
        </div>
      </Alert>
    ) : null

  if (load.status === 'loading') {
    return (
      <>
        {offlineNotice}
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <Spinner size="sm" aria-hidden="true" />
          진행 상태를 불러오는 중…
        </p>
      </>
    )
  }

  const { progress } = load
  const failure = progress.failure
  return (
    <section aria-label="배포 진행 상태" className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
      <div className="md:w-52 md:flex-none">
        <DeployStages states={stageStatesOf(progress)} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex items-center gap-2">
          <StatusBadge status={progress.status} />
          {isActive(progress.status) && offline !== 'stopped' && (
            <span className="flex items-center gap-2 text-sm text-muted">
              <Spinner size="sm" aria-hidden="true" />
              3초마다 새로 읽고 있어요
            </span>
          )}
        </div>
        {offlineNotice}

        {progress.status === 'not_started' && (
          <div className="flex flex-col gap-2">
            {startFailure && <StartFailureAlert failure={startFailure} />}
            {/* 진행 상태 응답은 비밀값이 필요한지 알려 주지 않는다. 새 요청 없이 시작 전에는 늘 링크를 두고, NOT_READY 뒤에도 그대로 보인다. */}
            <Link to={`/deploys/${deployId}/secrets`} className="self-start text-accent-text underline">
              비밀값 넣으러 가기
            </Link>
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
                    단계: {failedStageLabel(progress)}
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

        {progress.warnings.length > 0 && (
          <Alert variant="warn" title="보안 검사 경고가 있어요">
            <p>배포를 막지는 않았어요.</p>
            <ul className="mt-1 list-disc pl-5">
              {progress.warnings.map((warning, index) => (
                <li key={`${warning.code}-${index}`}>
                  {warning.message}
                  {warning.service ? ` (서비스: ${warning.service})` : ''}
                </li>
              ))}
            </ul>
          </Alert>
        )}

        {progress.status === 'succeeded' && progress.url?.startsWith('https://') && (
          <Card className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-lg">
              <span className="text-ok">
                <CheckIcon />
              </span>
              배포가 끝났어요
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <a href={progress.url} target="_blank" rel="noopener noreferrer" className="font-mono text-accent-text underline">
                {progress.url}
              </a>
              <CopyButton text={progress.url} />
            </div>
          </Card>
        )}
      </div>
    </section>
  )
}

export default DeployProgress
