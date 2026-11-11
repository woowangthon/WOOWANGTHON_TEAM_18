import AdminSection from './AdminSection.tsx'
import ProjectCard from './ProjectCard.tsx'
import type { AdminRead } from './useAdminRead.ts'
import type { ProjectsResponse } from './types.ts'

// 실행 중인 서비스(FR-083 · FR-084). 최근에 배포를 저장한 프로젝트부터 서버가 준 순서 그대로다.
function ProjectsSection({ read, onForbidden }: { read: AdminRead<ProjectsResponse>; onForbidden: () => void }) {
  return (
    <AdminSection
      id="services-heading"
      title="실행 중인 서비스"
      read={read}
      failed="서비스 목록을 읽지 못했어요"
      loading="서비스 목록을 불러오는 중…"
      empty="저장된 배포가 없어요."
      isEmpty={(data) => data.projects.length === 0}
    >
      {(data) => (
        <ul className="flex flex-col gap-3">
          {data.projects.map((project) => (
            <ProjectCard key={project.slug} project={project} onStopped={read.reload} onForbidden={onForbidden} />
          ))}
        </ul>
      )}
    </AdminSection>
  )
}

export default ProjectsSection
