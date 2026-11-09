import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { Alert } from '../components/ui/Alert.tsx'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Card } from '../components/ui/Card.tsx'
import { Field } from '../components/ui/Field.tsx'
import { ApiError, apiFetch } from '../lib/api.ts'
import DockerfileCheck from './DockerfileCheck.tsx'

type Failure = 'invalid-url' | 'not-linked' | 'not-owned' | 'not-found' | 'not-personal' | 'unavailable' | 'unknown'

const failureCopy: Record<Exclude<Failure, 'invalid-url'>, { title: string; body: string }> = {
  'not-linked': {
    title: 'GitHub 계정이 연동되지 않았어요',
    body: '먼저 프로필에서 GitHub를 연동해 주세요.',
  },
  'not-owned': {
    title: '내 GitHub 계정의 레포가 아니에요',
    body: '연동한 GitHub 계정이 소유한 공개 레포만 배포할 수 있어요. 다른 사람이나 조직의 레포는 지원하지 않아요.',
  },
  'not-found': {
    title: '레포를 찾을 수 없어요',
    body: '주소를 찾을 수 없어요. 오타가 없는지 확인해 주세요. 비공개 레포라면 공개로 바꾼 뒤 다시 확인해 주세요.',
  },
  'not-personal': {
    title: '지금은 개인 레포만 지원해요',
    body: '조직이 소유한 레포는 아직 배포할 수 없어요.',
  },
  unavailable: {
    title: '서버와 연결하지 못했어요',
    body: '사용자 잘못이 아니에요. 잠시 후 다시 시도해 주세요.',
  },
  unknown: {
    title: '레포를 확인하지 못했어요',
    body: '잠시 후 다시 시도해 주세요.',
  },
}

// 오류는 메시지 문장이 아니라 코드로 가른다. 로그인 만료(401)는 apiFetch가 로그아웃시키고 가드가 화면을 옮긴다.
function failureOf(error: unknown): Failure {
  if (!(error instanceof ApiError)) return 'unknown'
  switch (error.code) {
    case 'INVALID_REPO_URL':
      return 'invalid-url'
    case 'GITHUB_NOT_LINKED':
      return 'not-linked'
    case 'REPO_NOT_OWNED':
      return 'not-owned'
    case 'REPO_NOT_FOUND':
      return 'not-found'
    case 'REPO_NOT_PERSONAL':
      return 'not-personal'
  }
  return error.status === 503 || error.code === 'NETWORK_ERROR' ? 'unavailable' : 'unknown'
}

const URL_FORMAT_HINT = '올바른 GitHub 레포 주소가 아니에요. 예: https://github.com/소유자/레포'

function DeployNewPage() {
  const [repoUrl, setRepoUrl] = useState('')
  const [urlError, setUrlError] = useState<string | undefined>()
  const [failure, setFailure] = useState<Exclude<Failure, 'invalid-url'> | null>(null)
  const [checking, setChecking] = useState(false)
  // 통과한 레포. 입력을 고치면 지워서 이전 결과가 새 주소처럼 보이지 않게 한다.
  const [checked, setChecked] = useState<{ repo: string; repoUrl: string } | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = repoUrl.trim()
    setChecked(null)
    setFailure(null)
    setUrlError(undefined)
    if (trimmed === '') {
      setUrlError('레포 주소를 입력해 주세요')
      return
    }
    setChecking(true)
    try {
      const { repo } = await apiFetch<{ repo: string }>('/api/repos/check', { repoUrl: trimmed })
      setChecked({ repo, repoUrl: trimmed })
    } catch (error) {
      const found = failureOf(error)
      if (found === 'invalid-url') setUrlError(URL_FORMAT_HINT)
      else setFailure(found)
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <h1 className="text-xl">새 배포 요청</h1>
      <Card className="flex flex-col gap-4">
        <form
          noValidate
          onSubmit={(event) => {
            void handleSubmit(event)
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <Field
              label="레포 주소"
              type="url"
              placeholder="https://github.com/소유자/레포"
              value={repoUrl}
              onChange={(event) => {
                setRepoUrl(event.target.value)
                setChecked(null)
              }}
              error={urlError}
              disabled={checking}
            />
            <p className="text-sm text-muted">공개 개인 레포만 지원해요.</p>
          </div>
          <div>
            <Button type="submit" disabled={checking} aria-busy={checking}>
              {checking ? '확인하는 중…' : '레포 확인'}
            </Button>
          </div>
        </form>

        {failure && (
          <Alert title={failureCopy[failure].title}>
            <div className="flex flex-col gap-2">
              <p>{failureCopy[failure].body}</p>
              {failure === 'not-linked' && (
                <Link to="/profile" className="font-bold underline">
                  프로필로 이동
                </Link>
              )}
            </div>
          </Alert>
        )}

        {checked && (
          <div className="flex flex-col gap-2">
            <h2 className="text-lg">{checked.repo}</h2>
            <ul className="flex flex-col gap-1 text-sm">
              <li className="flex items-center gap-2">
                <Badge variant="ok">통과</Badge> 공개 레포예요
              </li>
              <li className="flex items-center gap-2">
                <Badge variant="ok">통과</Badge> 내 계정의 레포예요
              </li>
            </ul>
          </div>
        )}
      </Card>

      {checked && (
        <Card>
          <DockerfileCheck key={checked.repoUrl} repoUrl={checked.repoUrl} />
        </Card>
      )}
    </>
  )
}

export default DeployNewPage
