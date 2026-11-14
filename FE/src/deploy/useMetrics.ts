import { useQuery } from '@tanstack/react-query'
import { ApiError, apiFetch } from '../lib/api.ts'
import { queryKeys } from '../lib/query.ts'
import { METRICS_POLL_MS } from './metrics.ts'
import type { Metrics } from './metrics.ts'

// 한 배포의 서비스 지표(GET /api/deploys/:id/metrics). 서비스 상태 카드와 구성도가 같은 읽기를 나눠 쓴다(키가 같아 요청은 하나다).
// 보는 동안 METRICS_POLL_MS마다 다시 읽는다. 읽기가 실패해도 마지막 값은 남고 계속 시도한다.
// 이 배포가 공개 중이 아니라는 답(not_live)과 없는 배포(404)는 저절로 바뀌지 않으므로 멈춘다.
export function useMetrics(deployId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.metrics(deployId),
    queryFn: () => apiFetch<Metrics>(`/api/deploys/${deployId}/metrics`),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.state === 'not_live' || (query.state.error instanceof ApiError && query.state.error.status === 404)
        ? false
        : METRICS_POLL_MS,
  })
}
