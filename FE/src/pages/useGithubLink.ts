import { useQuery } from '@tanstack/react-query'
import { loadState, queryKeys } from '../lib/query.ts'
import { supabase } from '../lib/supabase.ts'

export type LinkState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'unlinked' }
  | { status: 'linked'; handle: string | null }

// 연동 여부는 연동 흐름(GitHub로 나갔다 돌아오는 전체 새로고침)이 끝나야 바뀌므로 5분 기억한다.
const GITHUB_LINK_STALE_MS = 5 * 60_000

async function readLink(): Promise<LinkState> {
  const { data, error } = await supabase.auth.getUserIdentities()
  if (error) throw error
  const github = data.identities.find((identity) => identity.provider === 'github')
  if (!github) return { status: 'unlinked' }
  const handle: unknown = github.identity_data?.user_name
  return { status: 'linked', handle: typeof handle === 'string' ? handle : null }
}

// 이 계정에 GitHub identity가 연결돼 있는지 읽는다. GitHub 연동 카드와 대시보드의 미연동 안내가 같은 값을 나눠 쓴다.
export function useGithubLink(): { link: LinkState; recheck: () => void } {
  const query = useQuery({
    queryKey: queryKeys.githubLink,
    queryFn: readLink,
    staleTime: GITHUB_LINK_STALE_MS,
  })
  const link: LinkState = loadState(query, (data) => data)
  return {
    link,
    recheck: () => {
      void query.refetch()
    },
  }
}
