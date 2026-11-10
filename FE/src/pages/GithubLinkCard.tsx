import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Alert } from '../components/ui/Alert.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Card } from '../components/ui/Card.tsx'
import { supabase } from '../lib/supabase.ts'

type LinkState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'unlinked' }
  | { status: 'linked'; handle: string | null }
type LinkFailure = 'cancelled' | 'exists' | 'temporary'

const failureText: Record<LinkFailure, string> = {
  cancelled: 'GitHub 화면에서 승인하지 않았어요. 다시 시도하면 돼요.',
  exists:
    '이 GitHub 계정은 다른 WCP 계정에 연동돼 있어요. 그 계정에서 연동을 풀거나 다른 GitHub 계정을 써 주세요.',
  temporary: 'GitHub 또는 우리 쪽 문제예요. 잠시 후 다시 시도해 주세요.',
}

// 연동 도중 실패하면 Supabase가 오류를 주소의 쿼리나 해시에 담아 이 화면으로 돌려보낸다.
// 코드로 먼저 가르고, 승인 취소처럼 코드가 따로 없는 경우만 이름에 access_denied가 들어 있는지 본다. 그 외는 일시 오류다.
function failureInUrl(search: string, hash: string): LinkFailure | null {
  const params = [new URLSearchParams(search), new URLSearchParams(hash.replace(/^#/, ''))]
  const read = (name: string) => params.map((p) => p.get(name)).find((v) => v !== null) ?? ''
  const error = read('error')
  const code = read('error_code')
  const description = read('error_description')
  if (!error && !code && !description) return null
  if (code === 'identity_already_exists') return 'exists'
  if ([error, code, description].some((v) => v.includes('access_denied'))) return 'cancelled'
  return 'temporary'
}

function failureOfLinkCall(error: { code?: string }): LinkFailure {
  return error.code === 'identity_already_exists' ? 'exists' : 'temporary'
}

function GithubLinkCard() {
  const location = useLocation()
  const [link, setLink] = useState<LinkState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [redirecting, setRedirecting] = useState(false)
  const [linkCallFailure, setLinkCallFailure] = useState<LinkFailure | null>(null)

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

  // GitHub에서 뒤로 가기로 돌아오면 브라우저가 이 화면을 멈춘 상태 그대로(이동하는 중) 되살릴 수 있다.
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) setRedirecting(false)
    }
    window.addEventListener('pageshow', restore)
    return () => {
      window.removeEventListener('pageshow', restore)
    }
  }, [])

  async function handleLink() {
    setLinkCallFailure(null)
    setRedirecting(true)
    try {
      // 성공하면 브라우저가 GitHub로 떠난다. 승인 뒤 이 화면으로 돌아온다.
      const { error } = await supabase.auth.linkIdentity({
        provider: 'github',
        options: {
          redirectTo: `${window.location.origin}/profile`,
          // GitHub는 브라우저에 로그인된 계정으로 바로 승인해 버린다. 계정이 여러 개인 학생이 고르게 한다.
          queryParams: { prompt: 'select_account' },
        },
      })
      if (error) {
        setLinkCallFailure(failureOfLinkCall(error))
        setRedirecting(false)
      }
    } catch {
      setLinkCallFailure('temporary')
      setRedirecting(false)
    }
  }

  const failure = linkCallFailure ?? failureInUrl(location.search, location.hash)

  if (link.status === 'loading') {
    return (
      <Card>
        <p role="status" className="text-sm text-muted">
          연동 결과를 확인하는 중…
        </p>
      </Card>
    )
  }

  if (link.status === 'failed') {
    return (
      <Card className="flex flex-col items-start gap-4">
        <Alert title="연동 상태를 확인하지 못했어요">잠시 후 다시 시도해 주세요.</Alert>
        <Button
          variant="outline"
          onClick={() => {
            setLink({ status: 'loading' })
            setAttempt((n) => n + 1)
          }}
        >
          다시 확인하기
        </Button>
      </Card>
    )
  }

  if (link.status === 'linked') {
    return (
      <Card className="flex flex-col items-start gap-3">
        <h2 className="text-lg">GitHub 계정을 연동했어요</h2>
        <p className="text-sm">
          {link.handle ? `@${link.handle} 계정이 연결됐어요.` : 'GitHub 계정이 연결됐어요.'} 이제
          새 배포를 요청할 수 있어요.
        </p>
        <Link to="/deploy/new" className="text-sm font-bold underline">
          새 배포 요청하기
        </Link>
      </Card>
    )
  }

  return (
    <Card className="flex flex-col items-start gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg">GitHub 계정 연동</h2>
        <p className="text-sm text-muted">배포를 요청하려면 한 번만 연동해 주세요.</p>
      </div>
      {failure && !redirecting && (
        <Alert title="GitHub 연동에 실패했어요">{failureText[failure]}</Alert>
      )}
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
        <li>내가 올린 레포가 내 계정 것인지 확인하는 데만 써요.</li>
        <li>읽기 권한만 요청해요. 코드를 바꾸지 않아요.</li>
        <li>GitHub로 로그인하는 건 아니에요. 로그인은 지금처럼 이메일로 해요.</li>
      </ul>
      <Button
        onClick={() => {
          void handleLink()
        }}
        disabled={redirecting}
        aria-busy={redirecting}
      >
        {redirecting ? 'GitHub로 이동하는 중…' : failure ? '다시 연동하기' : 'GitHub로 연동하기'}
      </Button>
      {redirecting && (
        <p role="status" className="text-sm text-muted">
          GitHub 화면으로 이동해요. 승인하면 이 화면으로 자동으로 돌아와요.
        </p>
      )}
    </Card>
  )
}

export default GithubLinkCard
