import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Alert } from '../components/ui/Alert.tsx'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Table, Td, Th, THead } from '../components/ui/Table.tsx'
import { statusLabel, statusVariant } from '../deploy/progress.ts'
import type { DeployListItem } from '../deploy/progress.ts'
import { apiFetch } from '../lib/api.ts'

type State = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; deploys: DeployListItem[] }

// 내 배포 목록(최신순). 새로 고침하거나 다시 들어와도 진행 중인 배포를 찾아 진행 화면으로 돌아가게 한다.
function DeploysPage() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let ignore = false
    apiFetch<{ deploys: DeployListItem[] }>('/api/deploys')
      .then(({ deploys }) => {
        if (!ignore) setState({ status: 'ready', deploys })
      })
      .catch(() => {
        // 실패를 "배포 없음"으로 바꾸지 않는다. 로그인 만료는 apiFetch가 로그아웃시킨다.
        if (!ignore) setState({ status: 'failed' })
      })
    return () => {
      ignore = true
    }
  }, [attempt])

  return (
    <>
      <h1 className="text-xl">내 배포</h1>
      {state.status === 'loading' && (
        <p role="status" className="text-sm text-muted">
          불러오는 중…
        </p>
      )}
      {state.status === 'failed' && (
        <Alert title="배포 목록을 불러오지 못했어요">
          <div className="flex flex-col gap-2">
            <p>사용자 잘못이 아니에요. 잠시 뒤에 다시 시도해 주세요.</p>
            <Button
              variant="outline"
              className="self-start"
              onClick={() => {
                setState({ status: 'loading' })
                setAttempt((count) => count + 1)
              }}
            >
              다시 시도
            </Button>
          </div>
        </Alert>
      )}
      {state.status === 'ready' && state.deploys.length === 0 && (
        <p>
          아직 배포가 없어요.{' '}
          <Link to="/deploy/new" className="underline">
            새 배포 요청하기
          </Link>
        </p>
      )}
      {state.status === 'ready' && state.deploys.length > 0 && (
        <Table aria-label="내 배포 목록">
          <THead>
            <tr>
              <Th>프로젝트</Th>
              <Th>레포</Th>
              <Th>상태</Th>
              <Th>만든 때</Th>
              <Th>
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
                  <Badge variant={statusVariant(deploy.status)}>{statusLabel(deploy.status)}</Badge>
                </Td>
                <Td>{new Date(deploy.createdAt).toLocaleString('ko-KR')}</Td>
                <Td>
                  <Link to={`/deploys/${deploy.id}`} className="underline">
                    보기<span className="sr-only"> ({deploy.slug})</span>
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  )
}

export default DeploysPage
