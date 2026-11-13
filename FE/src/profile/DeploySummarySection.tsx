import { Link } from 'react-router'
import { countProjects, groupProjects } from '../deploy/projects.ts'
import { useDeploys } from '../deploy/useDeploys.ts'
import { Button } from '../components/ui/Button.tsx'
import { Skeleton } from '../components/ui/Skeleton.tsx'
import ProfileSection from './ProfileSection.tsx'

function DeploySummarySection() {
  const { state, retry } = useDeploys()
  const counts = state.status === 'ready' ? countProjects(groupProjects(state.deploys)) : null
  return (
    <ProfileSection id="deploys" title="내 배포 요약">
      {state.status === 'loading' && (
        <>
          <Skeleton className="w-1/2" />
          <p role="status" className="text-sm text-muted">
            불러오는 중…
          </p>
        </>
      )}
      {state.status === 'failed' && (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-err">
            배포 요약을 불러오지 못했어요. 잠시 뒤에 다시 시도해 주세요.
          </p>
          <Button variant="outline" onClick={retry}>
            다시 시도
          </Button>
        </div>
      )}
      {counts && (
        <p className="text-sm">
          프로젝트 <b>{counts.total}개</b> · 실행 중 <b>{counts.running}개</b>
        </p>
      )}
      <Link to="/deploys" className="self-start text-sm text-accent-text underline">
        내 배포 보기
      </Link>
    </ProfileSection>
  )
}

export default DeploySummarySection
