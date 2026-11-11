import { useState } from 'react'
import type { FormEvent } from 'react'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Card } from '../components/ui/Card.tsx'
import { Field } from '../components/ui/Field.tsx'
import CommitRef from '../deploy/CommitRef.tsx'
import DeployConfirm from '../deploy/DeployConfirm.tsx'
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
  // 통과한 레포와 접수 때 확정한 commit(빈 레포는 null). 입력을 고치면 결과와 오류를 지워서 이전 주소의 것이 새 주소처럼 보이지 않게 한다.
  // dockerfiles는 Dockerfile 확인이 끝난 뒤에 채워진다. 배포 설정 화면이 이 목록으로 폼을 채운다.
  const [checked, setChecked] = useState<{
    repo: string
    repoUrl: string
    commit: string | null
    dockerfiles?: string[]
  } | null>(null)

  async function check(trimmed: string) {
    setChecked(null)
    setFailure(null)
    setUrlError(undefined)
    if (trimmed === '') {
      setUrlError('레포 주소를 입력해 주세요')
      return
    }
    setChecking(true)
    try {
      // commit은 줄이거나 다듬지 않고 그대로 들고 있다가 이후 단계에 넘긴다.
      const { repo, commit } = await apiFetch<{ repo: string; commit: string | null }>('/api/repos/check', {
        repoUrl: trimmed,
      })
      setChecked({ repo, repoUrl: trimmed, commit })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_REPO_URL') setUrlError(URL_FORMAT_HINT)
      else setFailure(failureOf(error))
    } finally {
      setChecking(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void check(repoUrl.trim())
  }

  return (
    <>
      <h1 className="text-xl">새 배포 요청</h1>
      <Card className="flex flex-col gap-4">
        <form
          noValidate
          onSubmit={handleSubmit}
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
                setFailure(null)
                setUrlError(undefined)
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
              <li className="flex flex-wrap items-center gap-2">
                <Badge variant="ok">확정</Badge> 배포할 commit
                {checked.commit ? <CommitRef commit={checked.commit} /> : <span>없음 (빈 레포)</span>}
              </li>
            </ul>
          </div>
        )}
      </Card>

      {checked && (
        <Card>
          <DockerfileCheck
            key={checked.repoUrl}
            repoUrl={checked.repoUrl}
            onDone={(dockerfiles) => {
              setChecked((current) => (current?.repoUrl === checked.repoUrl ? { ...current, dockerfiles } : current))
            }}
          />
        </Card>
      )}

      {checked?.dockerfiles && (
        <Card>
          <DeployConfirm
            key={`${checked.repoUrl}@${checked.commit ?? ''}`}
            repoUrl={checked.repoUrl}
            repo={checked.repo}
            commit={checked.commit}
            dockerfiles={checked.dockerfiles}
            onRecheck={() => {
              void check(checked.repoUrl)
            }}
          />
        </Card>
      )}
    </>
  )
}

export default DeployNewPage
