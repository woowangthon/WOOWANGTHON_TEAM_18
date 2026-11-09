import { useState } from 'react'
import type { FormEvent } from 'react'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Card } from '../components/ui/Card.tsx'
import { Field } from '../components/ui/Field.tsx'
import { ApiError, apiFetch } from '../lib/api.ts'
import DockerfileCheck from './DockerfileCheck.tsx'
import RepoFailureAlert from './RepoFailureAlert.tsx'
import { failureOf } from './repo-failure.ts'
import type { Failure } from './repo-failure.ts'

const URL_FORMAT_HINT = '올바른 GitHub 레포 주소가 아니에요. 예: https://github.com/소유자/레포'

function DeployNewPage() {
  const [repoUrl, setRepoUrl] = useState('')
  const [urlError, setUrlError] = useState<string | undefined>()
  const [failure, setFailure] = useState<Failure | null>(null)
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
      if (error instanceof ApiError && error.code === 'INVALID_REPO_URL') setUrlError(URL_FORMAT_HINT)
      else setFailure(failureOf(error))
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

        {failure && <RepoFailureAlert failure={failure} />}

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
