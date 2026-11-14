import { Link } from 'react-router'
import NoticeBanner from '../components/NoticeBanner.tsx'
import Logo from '../components/Logo.tsx'
import { primaryLinkClass } from '../components/primaryLinkClass.ts'
import { Button } from '../components/ui/Button.tsx'
import { Card } from '../components/ui/Card.tsx'
import { LoadingBlock } from '../components/ui/Skeleton.tsx'
import { countProjects, groupProjects } from '../deploy/projects.ts'
import type { Project, ProjectCounts } from '../deploy/projects.ts'
import StatusBadge from '../deploy/StatusBadge.tsx'
import { useDeploys } from '../deploy/useDeploys.ts'
import IncidentNotice from '../incidents/IncidentNotice.tsx'
import { useGithubLink } from './useGithubLink.ts'

const tiles: { key: keyof ProjectCounts; label: string }[] = [
  { key: 'total', label: '전체 프로젝트' },
  { key: 'running', label: '실행 중' },
  { key: 'inProgress', label: '진행 중' },
  { key: 'needsAttention', label: '확인 필요' },
]

// 공개 주소는 서버가 준 값이지만 http(s)일 때만 링크로 건다.
const isWebUrl = (url: string) => /^https?:\/\//i.test(url)

function ProjectRow({ project }: { project: Project }) {
  const { latest } = project
  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-bold">{project.slug}</span>
          <StatusBadge status={latest.status} />
        </div>
        <span className="font-mono text-sm break-all text-muted">{latest.repo}</span>
        {latest.url && isWebUrl(latest.url) && (
          <a
            href={latest.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm break-all text-accent-text underline"
          >
            {latest.url}
            <span className="sr-only"> (새 탭에서 열려요)</span>
          </a>
        )}
      </div>
      <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:gap-1">
        <span className="text-xs text-muted">
          마지막 배포 {new Date(latest.createdAt).toLocaleString('ko-KR')}
        </span>
        <Link to={`/deploys/${latest.id}`} className="text-sm text-accent-text underline">
          자세히<span className="sr-only"> ({project.slug})</span>
        </Link>
      </div>
    </li>
  )
}

// 로그인 뒤에 도착하는 곳. 내 배포(GET /api/deploys)를 프로젝트(slug)별로 묶어 최신 배포의 모습을 보인다.
function DashboardPage() {
  const { state, retry } = useDeploys()
  const { link } = useGithubLink()
  const projects = state.status === 'ready' ? groupProjects(state.deploys) : []
  const counts = countProjects(projects)

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl">대시보드</h1>
          <p className="text-muted">내 프로젝트의 배포 상태를 한눈에 봐요.</p>
        </div>
        <Link to="/deploy/new" className={primaryLinkClass}>
          새 배포 요청
        </Link>
      </div>

      {link.status === 'unlinked' && (
        <NoticeBanner variant="warn" title="GitHub 미연동">
          <p>
            배포를 요청하려면 GitHub 계정을 연동해야 해요.{' '}
            <Link to="/profile" className="font-bold text-accent-text underline">
              프로필에서 연동하기
            </Link>
          </p>
        </NoticeBanner>
      )}

      <IncidentNotice />

      {state.status === 'loading' && <LoadingBlock />}

      {state.status === 'failed' && (
        <NoticeBanner title="배포 목록을 불러오지 못했어요">
          <div className="flex flex-col gap-2">
            <p>사용자 잘못이 아니에요. 잠시 뒤에 다시 시도해 주세요.</p>
            <Button variant="outline" className="self-start" onClick={retry}>
              다시 시도
            </Button>
          </div>
        </NoticeBanner>
      )}

      {state.status === 'ready' && projects.length === 0 && (
        <Card className="flex flex-col items-start gap-3 p-6">
          <Logo className="size-12" />
          <p className="font-bold">아직 배포가 없어요.</p>
          <p className="text-sm text-muted">GitHub 레포 하나로 첫 배포를 요청해 보세요.</p>
          <Link to="/deploy/new" className={primaryLinkClass}>
            새 배포 요청하기
          </Link>
        </Card>
      )}

      {state.status === 'ready' && projects.length > 0 && (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map(({ key, label }) => (
              <Card key={key} className="flex flex-col gap-1 p-4">
                <dt className="text-sm text-muted">{label}</dt>
                <dd className="text-2xl font-bold">{counts[key]}</dd>
              </Card>
            ))}
          </dl>
          <section aria-labelledby="projects-heading" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="projects-heading" className="text-lg">
                프로젝트
              </h2>
              <Link to="/deploys" className="text-sm text-accent-text underline">
                내 배포 모두 보기
              </Link>
            </div>
            <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-bg">
              {projects.map((project) => (
                <ProjectRow key={project.slug} project={project} />
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  )
}

export default DashboardPage
