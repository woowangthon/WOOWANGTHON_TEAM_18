import { Link } from 'react-router'
import NoticeBanner from '../components/NoticeBanner.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Card } from '../components/ui/Card.tsx'
import { Skeleton } from '../components/ui/Skeleton.tsx'
import { primaryLinkClass } from '../components/primaryLinkClass.ts'
import { Table, Td, Th, THead } from '../components/ui/Table.tsx'
import StatusBadge from '../deploy/StatusBadge.tsx'
import { useDeploys } from '../deploy/useDeploys.ts'

// 내 배포 목록(최신순). 새로 고침하거나 다시 들어와도 진행 중인 배포를 찾아 진행 화면으로 돌아가게 한다.
function DeploysPage() {
  const { state, retry } = useDeploys()

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl">내 배포</h1>
        <p className="text-muted">요청한 배포를 최신순으로 봐요.</p>
      </div>
      {state.status === 'loading' && (
        <div className="flex flex-col gap-3">
          <Skeleton block />
          <p role="status" className="text-sm text-muted">
            불러오는 중…
          </p>
        </div>
      )}
      {state.status === 'failed' && (
        <NoticeBanner title="배포 목록을 불러오지 못했어요">
          <div className="flex flex-col gap-2">
            <p>사용자 잘못이 아니에요. 잠시 뒤에 다시 시도해 주세요.</p>
            <Button
              variant="outline"
              className="self-start"
              onClick={retry}
            >
              다시 시도
            </Button>
          </div>
        </NoticeBanner>
      )}
      {state.status === 'ready' &&
        (state.deploys.length === 0 ? (
          <Card className="flex flex-col items-start gap-3 p-6">
            <p className="font-bold">아직 배포가 없어요.</p>
            <Link
              to="/deploy/new"
              className={primaryLinkClass}
            >
              새 배포 요청하기
            </Link>
          </Card>
        ) : (
        <Table aria-label="내 배포 목록">
          <THead>
            <tr>
              <Th>프로젝트</Th>
              <Th>레포</Th>
              <Th>상태</Th>
              <Th>만든 때</Th>
              {/* sr-only는 absolute라 기준 요소가 없으면 표의 스크롤 영역 밖으로 문서 폭을 늘린다. */}
              <Th className="relative">
                <span className="sr-only">진행 화면</span>
              </Th>
            </tr>
          </THead>
          <tbody>
            {state.deploys.map((deploy) => (
              <tr key={deploy.id}>
                <Td className="font-mono">{deploy.slug}</Td>
                <Td className="font-mono">{deploy.repo}</Td>
                <Td>
                  <StatusBadge status={deploy.status} />
                </Td>
                <Td>{new Date(deploy.createdAt).toLocaleString('ko-KR')}</Td>
                <Td className="relative">
                  <Link to={`/deploys/${deploy.id}`} className="text-accent-text underline">
                    보기<span className="sr-only"> ({deploy.slug})</span>
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        ))}
    </>
  )
}

export default DeploysPage
