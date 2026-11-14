import { useState } from 'react'
import NoticeBanner from '../components/NoticeBanner.tsx'
import { CrossIcon } from '../components/ui/Icons.tsx'
import { useDeploys } from '../deploy/useDeploys.ts'
import Evidence from './Evidence.tsx'
import { isOpen, isStopped } from './types.ts'
import type { Incident } from './types.ts'
import { useIncidents } from './useIncidents.ts'

// 학생이 닫은 알림 id. 이 브라우저에만 남는다(저장소를 못 쓰면 이번 화면에서만 닫힌다).
const CLOSED_KEY = 'wcp.closedIncidents'
const readClosed = (): string[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
const saveClosed = (ids: string[]) => {
  try {
    localStorage.setItem(CLOSED_KEY, JSON.stringify(ids.slice(-100)))
  } catch {
    // 저장하지 못해도 이번 화면에서는 닫혀 있다.
  }
}

function IncidentBanner({ incident, onClose }: { incident: Incident; onClose: () => void }) {
  const stopped = isStopped(incident)
  return (
    <div className="relative">
      <NoticeBanner variant={stopped ? 'err' : 'warn'} title={stopped ? '서비스를 멈췄어요' : '운영 알림'}>
        <p className="pr-8">
          <span className="font-mono">{incident.slug}</span>: {incident.title}
        </p>
        {incident.ai.cause && <p>AI가 본 원인: {incident.ai.cause}</p>}
        <Evidence evidence={incident.evidence} />
      </NoticeBanner>
      <button type="button" aria-label="알림 닫기" onClick={onClose} className="absolute top-2 right-2 rounded-md p-2 text-muted hover:text-fg">
        <CrossIcon />
      </button>
    </div>
  )
}

// 내 프로젝트의 운영 알림. 멈춘 서비스(오류)와 운영자의 판단을 기다리는 알림(경고)을 보인다. 처리 끝난 알림(무시)과 내가 닫은 알림은 보이지 않는다.
// slug가 있으면 그 프로젝트의 것만, 없으면 모두 보인다.
function IncidentList({ slug }: { slug: string | undefined }) {
  const [closed, setClosed] = useState(readClosed)
  const shown = useIncidents().filter(
    (incident) =>
      (slug === undefined || incident.slug === slug) && (isStopped(incident) || isOpen(incident)) && !closed.includes(incident.id),
  )
  if (shown.length === 0) return null
  const close = (id: string) => {
    // 다른 탭이 그 사이 저장한 것도 합친다(덮어쓰지 않게).
    const next = [...new Set([...readClosed(), ...closed, id])]
    saveClosed(next)
    setClosed(next)
  }
  return (
    <>
      {shown.map((incident) => (
        <IncidentBanner key={incident.id} incident={incident} onClose={() => close(incident.id)} />
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
