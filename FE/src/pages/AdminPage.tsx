import { useState } from 'react'
import ForbiddenNotice from '../admin/ForbiddenNotice.tsx'
import IncidentsSection from '../admin/IncidentsSection.tsx'
import NodesSection from '../admin/NodesSection.tsx'
import ProjectsSection from '../admin/ProjectsSection.tsx'
import { Button } from '../components/ui/Button.tsx'
import { RefreshIcon } from '../components/ui/Icons.tsx'
import { isForbidden, REFRESH_MS, useAdminRead } from '../admin/useAdminRead.ts'
import type { NodesResponse, ProjectsResponse } from '../admin/types.ts'
import type { AdminIncidentsResponse } from '../incidents/types.ts'

// Admin Page(UC-17): 클러스터 노드와 실행 중인 학생 서비스를 보고 강제로 끈다. 숫자와 목록은 모두 서버가 준 그대로다.
function AdminPage() {
  // 화면은 편의로 막을 뿐이고 판단은 서버가 한다. 한 읽기라도 운영자가 아니라고(403) 하면 같은 화면으로 막고, 다른 읽기도 멈춘다.
  const [forbidden, setForbidden] = useState(false)
  const nodes = useAdminRead<NodesResponse>('/api/admin/nodes', forbidden)
  const projects = useAdminRead<ProjectsResponse>('/api/admin/projects', forbidden)
  const incidents = useAdminRead<AdminIncidentsResponse>('/api/admin/incidents', forbidden)
  if (!forbidden && (isForbidden(nodes.error) || isForbidden(projects.error) || isForbidden(incidents.error))) setForbidden(true)
  if (forbidden) return <ForbiddenNotice />
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl">관리자</h1>
        <p className="text-muted">운영 알림과 클러스터 노드, 실행 중인 서비스를 봐요.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>{REFRESH_MS / 1000}초마다 새로 읽어요</span>
        <Button
          variant="outline"
          aria-label="지금 새로 읽기"
          title="지금 새로 읽기"
          onClick={() => {
            nodes.reload()
            projects.reload()
            incidents.reload()
          }}
        >
          <RefreshIcon width={16} height={16} />
        </Button>
      </div>
      <IncidentsSection
        read={incidents}
        onForbidden={() => {
          setForbidden(true)
        }}
      />
      <NodesSection read={nodes} />
      <ProjectsSection
        read={projects}
        onForbidden={() => {
          setForbidden(true)
        }}
      />
    </>
  )
}

export default AdminPage
