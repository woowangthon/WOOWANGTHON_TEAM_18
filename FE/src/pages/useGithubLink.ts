import { useQuery } from '@tanstack/react-query'
import { GITHUB_LINK_STALE_MS, queryKeys } from '../lib/query.ts'
import { supabase } from '../lib/supabase.ts'

export type LinkState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'unlinked' }
  | { status: 'linked'; handle: string | null }

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
  const link: LinkState = query.data
    ? query.data
    : query.isError && !query.isFetching
      ? { status: 'failed' }
      : { status: 'loading' }
  return {
    link,
    recheck: () => {
      void query.refetch()
    },
  }
}
