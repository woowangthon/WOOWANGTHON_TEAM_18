import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api.ts'
import { queryKeys } from '../lib/query.ts'
import type { DeployListItem } from './progress.ts'

export type DeploysState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; deploys: DeployListItem[] }

// 내 배포 목록(GET /api/deploys)을 읽는다. 대시보드 · 내 배포 · 프로필이 같은 값을 나눠 쓴다.
// 기억해 둔 목록이 있으면 먼저 보이고, 화면이 열릴 때마다 뒤에서 새로 읽는다(배포를 만들거나 시작하면 상태가 바뀌므로 기억 시간을 두지 않는다). 새로 읽다 실패해도 기억해 둔 목록은 그대로다.
// 처음부터 실패하면 "배포 없음"이 아니라 실패다(로그인 만료는 apiFetch가 로그아웃시킨다).
export function useDeploys(): { state: DeploysState; retry: () => void } {
  const query = useQuery({
    queryKey: queryKeys.deploys,
    queryFn: async () => (await apiFetch<{ deploys: DeployListItem[] }>('/api/deploys')).deploys,
  })
  const state: DeploysState = query.data
    ? { status: 'ready', deploys: query.data }
    : query.isError && !query.isFetching
      ? { status: 'failed' }
      : { status: 'loading' }
  return {
    state,
    retry: () => {
      void query.refetch()
    },
  }
}
