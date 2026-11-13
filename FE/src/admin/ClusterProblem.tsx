import NoticeBanner from '../components/NoticeBanner.tsx'
import { ApiError } from '../lib/api.ts'
import { clusterAlert } from './clusterAlert.tsx'

// 읽기나 쓰기가 실패한 이유를 운영자에게 보인다. 클러스터 문제가 아닌 오류는 fallback 제목으로 보인다.
// stale이면 화면의 값이 마지막으로 읽은 것이라고 덧붙인다.
// retries: 화면이 알아서 다시 시도하는 읽기이면 true(기본), 사용자가 다시 눌러야 하는 쓰기이면 false.
export function ClusterProblem({ error, stale = false, retries = true, fallback }: { error: unknown; stale?: boolean; retries?: boolean; fallback: string }) {
  const code = error instanceof ApiError ? error.code : ''
  const note = stale ? '아래는 마지막으로 읽은 값이에요.' : ''
  const cluster = clusterAlert(code, note, retries)
  if (cluster) return cluster
  if (error instanceof ApiError && (error.status === 503 || code === 'NETWORK_ERROR')) {
    return (
      <NoticeBanner variant="warn" title="서버와 연결하지 못했어요">
        {retries ? '자동으로 다시 시도해요.' : '잠시 뒤에 다시 시도해 주세요.'} {note}
      </NoticeBanner>
    )
  }
  return <NoticeBanner title={fallback}>잠시 뒤에 다시 시도해 주세요. {note}</NoticeBanner>
}
