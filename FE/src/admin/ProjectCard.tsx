import { useState } from 'react'
import { Alert } from '../components/ui/Alert.tsx'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { ApiError, apiFetch } from '../lib/api.ts'
import { clusterAlert } from './clusterAlert.tsx'
import { ClusterProblem } from './ClusterProblem.tsx'
import { timeText } from './format.ts'
import Row from './Row.tsx'
import type { AdminProject, StopResponse } from './types.ts'
import { isForbidden } from './useAdminRead.ts'

// 공간의 서비스가 하나도 없거나(공간 없음) 모두 0개로 내려갔으면(중지됨) 끌 것이 없다. 중지 뒤에는 lastStop이 아니라 replicas를 본다.
// 공간을 읽지 못했으면(clusterError) 서비스가 없는 것이 아니라 모르는 것이다.
const stateOf = ({ services, clusterError }: AdminProject) =>
  clusterError ? 'unknown' : services.length === 0 ? 'none' : services.every((s) => s.replicas === 0) ? 'stopped' : 'running'

function StateBadge({ state }: { state: ReturnType<typeof stateOf> }) {
  switch (state) {
    case 'running':
      return <Badge variant="ok">실행 중</Badge>
    case 'stopped':
      return <Badge variant="neutral">중지됨</Badge>
    case 'none':
      return <Badge variant="neutral">공간 없음</Badge>
    case 'unknown':
      return <Badge variant="warn">읽지 못함</Badge>
  }
}

type StopState =
  | { step: 'idle' }
  | { step: 'confirm' }
  | { step: 'stopping' }
  | { step: 'done'; result: StopResponse }
  | { step: 'failed'; error: unknown }

// running: 끌 것이 있다(버튼을 보인다). 중지한 뒤 다시 읽으면 프로젝트가 중지됨이 되지만, 방금 한 일의 결과는 그대로 보여야 하므로 이 패널은 계속 그린다.
type StopHandlers = { onStopped: () => void; onForbidden: () => void }

function StopPanel({ slug, running, onStopped, onForbidden }: { slug: string; running: boolean } & StopHandlers) {
  const [stop, setStop] = useState<StopState>({ step: 'idle' })
  // 다시 배포되어 실행 중으로 돌아오면 지난 중지의 결과는 거둔다(낡은 "중지했어요"가 "실행 중" 아래 남지 않게).
  const [wasRunning, setWasRunning] = useState(running)
  if (wasRunning !== running) {
    setWasRunning(running)
    if (running && (stop.step === 'done' || stop.step === 'failed')) setStop({ step: 'idle' })
  }

  async function run() {
    setStop({ step: 'stopping' })
    try {
      // 계약은 본문 없는 POST지만 apiFetch는 본문이 있어야 POST로 보낸다. 빈 객체를 보낸다.
      const result = await apiFetch<StopResponse>(`/api/admin/projects/${slug}/stop`, {})
      setStop({ step: 'done', result })
    } catch (error) {
      // 운영자가 아니라는 답(403)은 이 카드의 일이 아니라 화면 전체의 일이다. 다시 읽기가 다른 이유로 실패해도 권한 안내로 바뀌게 바로 올린다.
      if (isForbidden(error)) {
        onForbidden()
        return
      }
      setStop({ step: 'failed', error })
    }
    // 성공이든 실패든 서버가 아는 상태를 다시 읽는다(일부만 내려갔을 수 있다).
    onStopped()
  }

  return (
    <div className="flex flex-col gap-2">
      {running && (stop.step === 'idle' || stop.step === 'done' || stop.step === 'failed') && (
        <Button
          variant="outline"
          className="self-start"
          aria-label={`${slug} 강제 중지`}
          onClick={() => {
            setStop({ step: 'confirm' })
          }}
        >
          강제 중지
        </Button>
      )}
      {(stop.step === 'confirm' || stop.step === 'stopping') && (
        <Alert variant="warn" title={`${slug}를 강제로 중지할까요?`}>
          <div className="flex flex-col gap-2">
            <p>모든 서비스를 0개로 내려요. 공개 주소가 더는 응답하지 않아요. 다시 켜는 기능은 아직 없고, 학생이 새로 배포하면 다시 떠요.</p>
            <div className="flex gap-2">
              <Button
                aria-label={`${slug} 중지하기`}
                disabled={stop.step === 'stopping'}
                aria-busy={stop.step === 'stopping'}
                onClick={() => void run()}
              >
                {stop.step === 'stopping' ? '중지하는 중…' : '중지하기'}
              </Button>
              <Button
                variant="outline"
                disabled={stop.step === 'stopping'}
                onClick={() => {
                  setStop({ step: 'idle' })
                }}
              >
                취소
              </Button>
            </div>
          </div>
        </Alert>
      )}
      {stop.step === 'done' && (
        <Alert variant="info" title={stop.result.failed.length === 0 ? '중지했어요' : '일부만 중지했어요'}>
          <div className="flex flex-col gap-1">
            {stop.result.scaled.length > 0 && <p>내린 서비스: {stop.result.scaled.join(', ')}</p>}
            {stop.result.failed.length > 0 && (
              <p>내리지 못한 서비스: {stop.result.failed.join(', ')}. 다시 중지하면 이어서 내려요.</p>
            )}
          </div>
        </Alert>
      )}
      {stop.step === 'failed' && <StopProblem error={stop.error} />}
    </div>
  )
}

function StopProblem({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.code === 'NOT_RUNNING') {
    return (
      <Alert variant="info" title="이미 꺼져 있어요">
        실행 중인 서비스가 없어서 아무것도 바뀌지 않았어요.
      </Alert>
    )
  }
  if (error instanceof ApiError && error.code === 'PROJECT_NOT_FOUND') {
    return <Alert title="프로젝트를 찾을 수 없어요">목록에서 사라졌을 수 있어요. 새로 읽으면 보여요.</Alert>
  }
  // 중지는 POST라서 읽기와 달리 자동으로 다시 시도하지 않는다. 공용 안내에는 retries={false}를 넘겨 "자동으로 다시 시도해요"를 빼고, 이 호출에만 있는 뜻만 따로 둔다.
  if (error instanceof ApiError && error.code === 'CLUSTER_FORBIDDEN') {
    // 서버의 scale 호출이 아직 붙지 않아 지금은 늘 이 오류다(docs/design/api.md "강제 중지"). 운영자가 잘못한 것이 아니다.
    return (
      <Alert variant="warn" title="아직 강제 중지를 쓸 수 없어요">
        운영자 잘못이 아니에요. 서버가 서비스를 내릴 권한이 아직 없어요. 인프라 담당이 권한을 주고 서버에 연결하면 쓸 수 있어요.
      </Alert>
    )
  }
  if (error instanceof ApiError && error.code === 'DATABASE_UNAVAILABLE') {
    return (
      <Alert variant="warn" title="저장소에 닿지 못했어요">
        서비스를 내리기 전에 실패했는지, 내린 뒤 기록하다 실패했는지는 알 수 없어요. 새로 읽은 목록에서 상태를 확인하세요. 같은 중지를 다시 해도 안전해요.
      </Alert>
    )
  }
  return <ClusterProblem error={error} retries={false} fallback="중지하지 못했어요" />
}

// 프로젝트 하나. 서비스(Deployment)와 Pod의 상태를 보이고, 확인을 거쳐 강제 중지할 수 있다(FR-084 · FR-094).
function ProjectCard({ project, onStopped, onForbidden }: { project: AdminProject } & StopHandlers) {
  const state = stateOf(project)
  return (
    <li className="flex flex-col gap-3 rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-bold">{project.slug}</span>
        <StateBadge state={state} />
        {project.liveSlot && <Badge variant="info">라이브 슬롯 {project.liveSlot}</Badge>}
      </div>
      <dl className="flex flex-col gap-1 text-sm">
        <Row label="레포">
          <span className="font-mono break-all">{project.repo}</span>
        </Row>
        <Row label="소유자">
          <span className="font-mono break-all">{project.ownerId}</span>
        </Row>
        <Row label="주소">
          {project.url?.startsWith('https://') ? (
            <a href={project.url} target="_blank" rel="noopener noreferrer" className="font-mono break-all underline">
              {project.url}
            </a>
          ) : (
            '아직 없음'
          )}
        </Row>
        {project.lastStop && (
          <Row label="마지막 중지">
            {timeText(project.lastStop.at)} · <span className="break-all">{project.lastStop.by}</span>
          </Row>
        )}
      </dl>
      {project.clusterError && clusterAlert(project.clusterError, '이 프로젝트만 읽지 못했어요.')}
      {project.services.length > 0 && (
        <ul className="flex flex-col gap-2">
          {project.services.map((service) => (
            <li key={service.name} className="flex flex-col gap-1 border-t border-line pt-2 text-sm">
              <p>
                <span className="font-mono font-bold">{service.name}</span>
                <span className="text-muted">
                  {' '}
                  · 준비 {service.readyReplicas}/{service.replicas}
                </span>
              </p>
              {service.pods.length > 0 && (
                <ul className="flex flex-col gap-0.5 text-muted">
                  {service.pods.map((pod) => (
                    <li key={pod.name} className="break-all">
                      <span className="font-mono">{pod.name}</span> · {pod.phase}
                      {pod.ready ? '' : ' · 준비 안 됨'}
                      {pod.node ? ` · 노드 ${pod.node}` : ''} · 재시작 {pod.restarts}회
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <StopPanel slug={project.slug} running={state === 'running'} onStopped={onStopped} onForbidden={onForbidden} />
    </li>
  )
}

export default ProjectCard
