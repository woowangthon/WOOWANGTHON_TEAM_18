import { QueryClient } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'

// 읽기(GET)를 화면 사이에서 기억해 두고, 다시 들어오면 기억해 둔 값을 먼저 보이고 뒤에서 새로 읽는다(stale-while-revalidate).
// retry: 이전 화면들은 실패하면 바로 알렸다. 알아서 다시 시도하지 않고, 화면의 "다시 시도" 버튼이 맡는다.
// refetchOnWindowFocus: 창에 돌아올 때마다 읽지 않는다(이전에도 그랬다). 요청 수가 화면 이동과 새로 읽기 간격으로만 정해지게 한다.
export function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
}

// 같은 키는 같은 값이다. 사용자가 바뀌면 SessionCache가 기억해 둔 값을 모두 지운다.
export const queryKeys = {
  deploys: ['deploys'] as const,
  githubLink: ['github-link'] as const,
  admin: (path: string) => ['admin', path] as const,
}

// 읽기 결과를 화면 상태로 바꾼다. 기억해 둔 값이 있으면 그것을, 처음부터 실패했고 읽는 중이 아니면 실패를, 그 밖에는 로딩을 보인다.
export function loadState<T, R>(
  query: UseQueryResult<T>,
  ready: (data: T) => R,
): R | { status: 'failed' } | { status: 'loading' } {
  if (query.data !== undefined) return ready(query.data)
  return query.isError && !query.isFetching ? { status: 'failed' } : { status: 'loading' }
}
