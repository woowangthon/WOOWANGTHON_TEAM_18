import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api.ts'
import { queryKeys } from '../lib/query.ts'
import type { SavedDeploy } from './types.ts'

// 저장한 배포 입력(GET /api/deploys/:id): 프로젝트 이름 · 레포 · commit과 서비스 구성. 저장한 값은 바뀌지 않아 한 번만 읽는다.
// 보태는 정보라서 읽지 못하면 data가 없을 뿐이고 화면은 그 부분만 그리지 않는다.
export function useSavedDeploy(deployId: string) {
  return useQuery({
    queryKey: queryKeys.deploy(deployId),
    queryFn: () => apiFetch<SavedDeploy>(`/api/deploys/${deployId}`),
    staleTime: Infinity,
    // 빈 id면 부르지 않는다(다시 배포로 온 때만 이전 배포를 읽는 화면이 쓴다).
    enabled: deployId !== '',
  })
}
