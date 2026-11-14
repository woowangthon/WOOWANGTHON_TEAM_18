import { useState } from 'react'
import NoticeBanner from '../components/NoticeBanner.tsx'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { recommendationText, riskText } from '../incidents/types.ts'
import type { AdminIncident, AdminIncidentsResponse } from '../incidents/types.ts'
import { ApiError, apiFetch } from '../lib/api.ts'
import AdminSection from './AdminSection.tsx'
import { ClusterProblem } from './ClusterProblem.tsx'
import { timeText } from './format.ts'
import Row from './Row.tsx'
import { isForbidden } from './useAdminRead.ts'
import type { AdminRead } from './useAdminRead.ts'

function ActionBadge({ action }: { action: AdminIncident['action'] }) {
  if (action === 'auto_stopped') return <Badge variant="err">자동 중지</Badge>
  if (action === 'pending') return <Badge variant="warn">판단 대기</Badge>
  return <Badge variant="neutral">처리됨</Badge>
}

// AI 판단 줄. 건너뛴 알림(skipped)은 AI가 관여하지 않았으므로 줄이 없다. 모르는 값은 그리지 않는다.
function AiRows({ ai }: { ai: AdminIncident['ai'] }) {
  if (ai.status === 'skipped') return null
  if (ai.status === 'pending') return <p className="text-sm text-muted">AI가 판단하고 있어요</p>
  if (ai.status === 'failed') return <p className="text-sm text-muted">AI 판단을 받지 못했어요</p>
  return (
    <dl className="flex flex-col gap-1 text-sm">
      {ai.risk && <Row label="AI 위험">{riskText(ai.risk)}</Row>}
      {ai.recommendation && <Row label="AI 권고">{recommendationText(ai.recommendation)}</Row>}
      {ai.cause && <Row label="원인">{ai.cause}</Row>}
      {ai.reason && <Row label="이유">{ai.reason}</Row>}
    </dl>
  )
}

type Step =
  | { step: 'idle' }
  | { step: 'confirm' }
  | { step: 'working'; what: 'stop' | 'dismiss' }
  | { step: 'done'; what: 'stop' | 'dismiss' }
  | { step: 'failed'; error: unknown }

type Handlers = { onChanged: () => void; onForbidden: () => void }

function DecisionProblem({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.code === 'INCIDENT_CLOSED') {
    return (
      <NoticeBanner variant="info" title="이미 처리된 알림이에요">
        다른 운영자가 먼저 처리했거나 자동으로 멈췄어요. 새로 읽으면 처리된 모습이 보여요.
      </NoticeBanner>
    )
  }
  if (error instanceof ApiError && error.code === 'INCIDENT_NOT_FOUND') {
    return <NoticeBanner title="알림을 찾을 수 없어요">목록에서 사라졌을 수 있어요. 새로 읽으면 보여요.</NoticeBanner>
  }
  if (error instanceof ApiError && error.code === 'STOP_INCOMPLETE') {
    // 결정은 이미 중지로 기록됐다. 다시 읽으면 처리됨으로 보이므로 이 안내는 그 뒤에도 남아야 한다.
    return (
      <NoticeBanner variant="warn" title="일부 서비스만 멈췄어요">
        아래 프로젝트 목록에서 강제 중지로 나머지를 멈춰 주세요.
      </NoticeBanner>
    )
  }
  // 처리는 POST라서 자동으로 다시 시도하지 않는다.
  return <ClusterProblem error={error} retries={false} fallback="알림을 처리하지 못했어요" />
}

// 판단을 기다리는 알림의 버튼. 중지는 프로젝트의 서비스를 모두 내리므로 확인을 거치고, 무시는 바로 처리한다.
function DecisionPanel({ incident, onChanged, onForbidden }: { incident: AdminIncident } & Handlers) {
  const [state, setState] = useState<Step>({ step: 'idle' })
  const busy = state.step === 'working'
  const { id, slug, title } = incident

  async function decide(what: 'stop' | 'dismiss') {
    setState({ step: 'working', what })
    try {
      // 계약은 본문 없는 POST지만 apiFetch는 본문이 있어야 POST로 보낸다. 빈 객체를 보낸다.
      await apiFetch(`/api/admin/incidents/${id}/${what}`, {})
      setState({ step: 'done', what })
    } catch (error) {
      // 운영자가 아니라는 답(403)은 이 카드의 일이 아니라 화면 전체의 일이다.
      if (isForbidden(error)) {
        onForbidden()
        return
      }
      setState({ step: 'failed', error })
    }
    // 성공이든 실패든 서버가 아는 상태를 다시 읽는다(이미 처리된 알림이면 처리된 모습이 보인다).
    onChanged()
  }

  return (
    <div className="flex flex-col gap-2">
      {incident.action === 'pending' && (state.step === 'idle' || state.step === 'failed') && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            aria-label={`${slug} ${title} 중지`}
            onClick={() => {
              setState({ step: 'confirm' })
            }}
          >
            중지
          </Button>
          <Button variant="outline" aria-label={`${slug} ${title} 무시`} onClick={() => void decide('dismiss')}>
            무시
          </Button>
        </div>
      )}
      {(state.step === 'confirm' || (busy && state.what === 'stop')) && (
        <NoticeBanner variant="warn" title={`${slug}를 중지할까요?`}>
          <div className="flex flex-col gap-2">
            <p>모든 서비스를 0개로 내려요. 공개 주소가 더는 응답하지 않아요. 다시 켜는 기능은 아직 없고, 학생이 새로 배포하면 다시 떠요.</p>
            <div className="flex gap-2">
              <Button aria-label={`${slug} ${title} 중지하기`} disabled={busy} aria-busy={busy} onClick={() => void decide('stop')}>
                {busy ? '중지하는 중…' : '중지하기'}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setState({ step: 'idle' })
                }}
              >
                취소
              </Button>
            </div>
          </div>
        </NoticeBanner>
      )}
      {busy && state.what === 'dismiss' && <p className="text-sm text-muted">무시하는 중…</p>}
      {state.step === 'done' && (
        <NoticeBanner variant="info" title={state.what === 'stop' ? '중지했어요' : '무시했어요'} />
      )}
      {state.step === 'failed' && <DecisionProblem error={state.error} />}
    </div>
  )
}

const actionText = { stopped: '중지', dismissed: '무시' } as const

function IncidentCard({ incident, onChanged, onForbidden }: { incident: AdminIncident } & Handlers) {
  const { action } = incident
  return (
    <li className="flex flex-col gap-3 rounded-md border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{incident.title}</span>
        <ActionBadge action={action} />
      </div>
      <dl className="flex flex-col gap-1 text-sm">
        <Row label="프로젝트">
          <span className="font-mono break-all">{incident.slug}</span>
        </Row>
        <Row label="시작">{timeText(incident.firedAt)}</Row>
        {incident.resolvedAt && <Row label="해소">{timeText(incident.resolvedAt)}</Row>}
        {(action === 'stopped' || action === 'dismissed') && (
          <Row label="처리">
            {actionText[action]}
            {incident.decidedAt ? ` · ${timeText(incident.decidedAt)}` : ''}
            {incident.decidedBy ? ' · ' : ''}
            {incident.decidedBy && <span className="break-all">{incident.decidedBy}</span>}
          </Row>
        )}
      </dl>
      <AiRows ai={incident.ai} />
      {action === 'auto_stopped' && <p className="text-sm text-muted">자동으로 멈췄어요</p>}
      {/* 처리된 뒤에도 그 처리의 결과 안내가 남도록 늘 그린다. 버튼은 판단 대기일 때만 나온다. */}
      <DecisionPanel incident={incident} onChanged={onChanged} onForbidden={onForbidden} />
    </li>
  )
}

// 스파이크 감지가 낸 운영 알림. 최근 50개이고 열린 것이 먼저다(서버가 준 순서 그대로).
function IncidentsSection({ read, onForbidden }: { read: AdminRead<AdminIncidentsResponse>; onForbidden: () => void }) {
  return (
    <AdminSection
      id="incidents-heading"
      title="운영 알림"
      read={read}
      failed="운영 알림을 읽지 못했어요"
      loading="운영 알림을 불러오는 중…"
      empty="운영 알림이 없어요."
      isEmpty={(data) => data.incidents.length === 0}
    >
      {(data) => (
        <ul className="flex flex-col gap-3">
          {data.incidents.map((incident) => (
            <IncidentCard key={incident.id} incident={incident} onChanged={read.reload} onForbidden={onForbidden} />
          ))}
        </ul>
      )}
    </AdminSection>
  )
}

export default IncidentsSection
