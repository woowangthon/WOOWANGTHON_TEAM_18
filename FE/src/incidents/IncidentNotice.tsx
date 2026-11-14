import NoticeBanner from '../components/NoticeBanner.tsx'
import { useDeploys } from '../deploy/useDeploys.ts'
import { isOpen, isStopped } from './types.ts'
import type { Incident } from './types.ts'
import { useIncidents } from './useIncidents.ts'

function IncidentBanner({ incident }: { incident: Incident }) {
  const stopped = isStopped(incident)
  return (
    <NoticeBanner variant={stopped ? 'err' : 'warn'} title={stopped ? '서비스를 멈췄어요' : '운영 알림'}>
      <p>
        <span className="font-mono">{incident.slug}</span>: {incident.title}
      </p>
      {incident.ai.cause && <p>AI가 본 원인: {incident.ai.cause}</p>}
    </NoticeBanner>
  )
}

// 내 프로젝트의 운영 알림. 멈춘 서비스(오류)와 운영자의 판단을 기다리는 알림(경고)을 보인다. 처리 끝난 알림(무시)은 보이지 않는다.
// slug가 있으면 그 프로젝트의 것만, 없으면 모두 보인다.
function IncidentList({ slug }: { slug: string | undefined }) {
  const shown = useIncidents().filter(
    (incident) => (slug === undefined || incident.slug === slug) && (isStopped(incident) || isOpen(incident)),
  )
  if (shown.length === 0) return null
  return (
    <>
      {shown.map((incident) => (
        <IncidentBanner key={incident.id} incident={incident} />
      ))}
    </>
  )
}

// 배포 진행 화면은 프로젝트 이름(slug)을 모르고 배포 id만 안다. 내 배포 목록(이미 기억해 둔 값)에서 찾고, 못 찾으면 아무것도 보이지 않는다.
function DeployIncidentList({ deployId }: { deployId: string }) {
  const { state } = useDeploys()
  const slug = state.status === 'ready' ? state.deploys.find((d) => d.id === deployId)?.slug : undefined
  return slug === undefined ? null : <IncidentList slug={slug} />
}

function IncidentNotice({ deployId }: { deployId?: string }) {
  return deployId === undefined ? <IncidentList slug={undefined} /> : <DeployIncidentList deployId={deployId} />
}

export default IncidentNotice
