import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.ts'

export type LinkState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'unlinked' }
  | { status: 'linked'; handle: string | null }

// 이 계정에 GitHub identity가 연결돼 있는지 읽는다. GitHub 연동 카드와 대시보드의 미연동 안내가 함께 쓴다.
export function useGithubLink(): { link: LinkState; recheck: () => void } {
  const [link, setLink] = useState<LinkState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let ignore = false
    supabase.auth
      .getUserIdentities()
      .then(({ data, error }) => {
        if (ignore) return
        if (error) {
          setLink({ status: 'failed' })
          return
        }
        const github = data.identities.find((identity) => identity.provider === 'github')
        if (!github) {
          setLink({ status: 'unlinked' })
          return
        }
        const handle: unknown = github.identity_data?.user_name
        setLink({ status: 'linked', handle: typeof handle === 'string' ? handle : null })
      })
      .catch(() => {
        if (!ignore) setLink({ status: 'failed' })
      })
    return () => {
      ignore = true
    }
  }, [attempt])

  return {
    link,
    recheck: () => {
      setLink({ status: 'loading' })
      setAttempt((n) => n + 1)
    },
  }
}
