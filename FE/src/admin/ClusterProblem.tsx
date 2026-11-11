import { Alert } from '../components/ui/Alert.tsx'
import { ApiError } from '../lib/api.ts'

// 클러스터 문제는 두 가지로 가른다(docs/design/api.md "운영자 API").
// CLUSTER_UNREACHABLE: 리더에 닿지 못했다. CLUSTER_FORBIDDEN: 닿았지만 서버 계정에 권한이 없다. 그 밖의 코드는 null이다.
export function clusterAlert(code: string, note = '') {
  if (code === 'CLUSTER_UNREACHABLE') {
    return (
      <Alert variant="warn" title="리더 무응답">
        리더의 쿠버네티스 API에 닿지 못했어요. 자동으로 다시 시도해요. {note}
      </Alert>
    )
  }
  if (code === 'CLUSTER_FORBIDDEN') {
    return (
      <Alert variant="warn" title="리더에는 닿았지만 서버 계정에 권한이 없어요">
        인프라 담당이 서버 계정에 권한을 줘야 해요. {note}
      </Alert>
    )
  }
  return null
}

// 읽기나 쓰기가 실패한 이유를 운영자에게 보인다. 클러스터 문제가 아닌 오류는 fallback 제목으로 보인다.
// stale이면 화면의 값이 마지막으로 읽은 것이라고 덧붙인다.
export function ClusterProblem({ error, stale = false, fallback }: { error: unknown; stale?: boolean; fallback: string }) {
  const code = error instanceof ApiError ? error.code : ''
  const note = stale ? '아래는 마지막으로 읽은 값이에요.' : ''
  const cluster = clusterAlert(code, note)
  if (cluster) return cluster
  if (error instanceof ApiError && (error.status === 503 || code === 'NETWORK_ERROR')) {
    return (
      <Alert variant="warn" title="서버와 연결하지 못했어요">
        자동으로 다시 시도해요. {note}
      </Alert>
    )
  }
  return <Alert title={fallback}>잠시 뒤에 다시 시도해 주세요. {note}</Alert>
}
