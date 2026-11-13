import { QueryClient } from '@tanstack/react-query'

// 읽기(GET)를 화면 사이에서 기억해 두고, 다시 들어오면 기억해 둔 값을 먼저 보이고 뒤에서 새로 읽는다(stale-while-revalidate).
// retry: 이전 화면들은 실패하면 바로 알렸다. 알아서 다시 시도하지 않고, 화면의 "다시 시도" 버튼이 맡는다.
export function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

// 같은 키는 같은 값이다. 사용자가 바뀌면 SessionCache가 기억해 둔 값을 모두 지운다.
export const queryKeys = {
  deploys: ['deploys'] as const,
  githubLink: ['github-link'] as const,
  admin: (path: string) => ['admin', path] as const,
}

// 다른 화면으로 갔다 와도 이 시간 안에는 같은 읽기를 다시 보내지 않는다.
export const DEPLOYS_STALE_MS = 15_000
// GitHub 연동 여부는 연동 흐름(GitHub로 나갔다 돌아오는 전체 새로고침)이 끝나야 바뀐다.
export const GITHUB_LINK_STALE_MS = 5 * 60_000
