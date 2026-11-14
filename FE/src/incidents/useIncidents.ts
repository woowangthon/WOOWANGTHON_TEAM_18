import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api.ts'
import { queryKeys } from '../lib/query.ts'
import type { Incident, IncidentsResponse } from './types.ts'

// 학생 화면이 내 프로젝트의 운영 알림을 새로 읽는 간격.
export const INCIDENTS_POLL_MS = 30_000

// 내 프로젝트의 운영 알림(GET /api/incidents). 열린 것과 최근 24시간에 멈춘 것이 온다. 알림은 보태는 안내라서 읽지 못하면 아무것도 보이지 않는다(실패 안내는 두지 않는다).
export function useIncidents(): Incident[] {
  const query = useQuery({
    queryKey: queryKeys.incidents,
    queryFn: async () => (await apiFetch<IncidentsResponse>('/api/incidents')).incidents,
    refetchInterval: INCIDENTS_POLL_MS,
  })
  return query.data ?? []
}
