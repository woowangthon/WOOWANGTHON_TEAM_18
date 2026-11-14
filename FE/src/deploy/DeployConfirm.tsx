import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '../components/ui/Alert.tsx'
import { Banner } from '../components/ui/Banner.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Skeleton } from '../components/ui/Skeleton.tsx'
import { Spinner } from '../components/ui/Spinner.tsx'
import { ApiError, apiFetch } from '../lib/api.ts'
import RepoFailureAlert from '../pages/RepoFailureAlert.tsx'
import { failureOf, isRetryable } from '../pages/repo-failure.ts'
import type { Failure } from '../pages/repo-failure.ts'
import DeploySaved from './DeploySaved.tsx'
import { issueMap, issuesOf, issueText, withoutField } from './issues.ts'
import { MAX_SERVICES } from './limits.ts'
import SpecFormFields from './SpecFormFields.tsx'
import { formFromDraft, formFromSpec, localIssues, toSpec } from './spec-form.ts'
import type { SpecForm } from './spec-form.ts'
import type { DeploySpecDraft, Issue, SavedDeploy, Spec } from './types.ts'

type Props = {
  repoUrl: string
  repo: string
  // repos/check가 준 값 그대로. 줄이거나 다듬지 않는다. 빈 레포는 null이다.
  commit: string | null
  dockerfiles: string[]
  // 접수한 뒤 레포가 바뀌어 commit을 찾을 수 없을 때, 확인부터 다시 하게 한다.
  onRecheck: () => void
  // 다시 배포: 이전 배포에서 저장한 설정. 있으면 초안 대신 이 값으로 폼을 채운다(commit은 새 값이다).
  previous?: Spec
}

type Load =
  | { status: 'loading' }
  | { status: 'failed'; failure: Failure | 'commit-gone' }
  | { status: 'done'; draft: DeploySpecDraft }

// 확인한 레포의 초안을 미리 채운 폼으로 보여 주고, 사용자가 확정하면 POST /api/deploys로 저장한다.
function DeployConfirm({ repoUrl, repo, commit, dockerfiles, onRecheck, previous }: Props) {
  // commit이 없으면(빈 레포) 초안을 부르지 않는다. 읽을 코드가 없다.
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [form, setForm] = useState<SpecForm | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [serverIssues, setServerIssues] = useState<Issue[]>([])
  const [saving, setSaving] = useState(false)
  const [saveFailure, setSaveFailure] = useState<Failure | 'commit-gone' | null>(null)
  const [saved, setSaved] = useState<SavedDeploy | null>(null)

  // 같은 입력(레포 + commit)으로는 한 번만 부른다. 다시 시도는 사용자가 누를 때만 한다.
  useEffect(() => {
    if (!commit) return
    let ignore = false
    apiFetch<DeploySpecDraft>('/api/repos/deploy-spec', { repoUrl, commit })
      .then((draft) => {
        if (ignore) return
        setForm(previous ? formFromSpec(previous) : formFromDraft(draft, repo, dockerfiles))
        setLoad({ status: 'done', draft })
      })
      .catch((error: unknown) => {
        if (!ignore) setLoad({ status: 'failed', failure: failureOfDeploy(error) })
      })
    return () => {
      ignore = true
    }
    // dockerfiles는 부모가 확인을 마친 뒤에만 이 컴포넌트를 그리므로 바뀌지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoUrl, commit, repo, attempt])

  // 입력이 끝났으니 서버 오류는 거둔다(고친 칸에 옛 오류가 남지 않게). 명백한 오류는 아래에서 다시 계산한다.
  function edit(next: SpecForm) {
    setForm(next)
    setServerIssues([])
    setSaveFailure(null)
  }

  async function confirm(current: SpecForm, sha: string) {
    setAttempted(true)
    setSaveFailure(null)
    setServerIssues([])
    if (localIssues(current).length > 0) return
    setSaving(true)
    try {
      setSaved(await apiFetch<SavedDeploy>('/api/deploys', { repoUrl, commit: sha, spec: toSpec(current) }))
    } catch (error) {
      const issues = issuesOf(error)
      if (issues) setServerIssues(issues)
      else setSaveFailure(failureOfDeploy(error))
    } finally {
      setSaving(false)
    }
  }

  if (saved) return <DeploySaved saved={saved} />

  if (commit === null) {
    return (
      <Section>
        <Alert variant="warn" title="이 레포에는 아직 commit이 없어요">
          배포할 코드가 없어서 설정을 확정할 수 없어요. 코드를 올린 뒤 레포를 다시 확인해 주세요.
        </Alert>
        <div>
          <Button disabled>배포 설정 확정</Button>
        </div>
      </Section>
    )
  }

  return (
    <Section>
      {load.status === 'loading' && (
        <div className="flex flex-col gap-3">
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <Spinner size="sm" aria-hidden="true" />
            배포 설정 초안을 만드는 중…
          </p>
          <Skeleton block />
        </div>
      )}

      {load.status === 'failed' && (
        <FailureBlock
          failure={load.failure}
          title="배포 설정 초안을 만들지 못했어요"
          onRecheck={onRecheck}
          onRetry={() => {
            setLoad({ status: 'loading' })
            setAttempt((n) => n + 1)
          }}
        />
      )}

      {load.status === 'done' && form && (
        <Editor
          draft={load.draft}
          form={form}
          dockerfiles={dockerfiles}
          issues={[...(attempted ? localIssues(form) : []), ...serverIssues]}
          saving={saving}
          saveFailure={saveFailure}
          onEdit={edit}
          onRecheck={onRecheck}
          onConfirm={() => {
            void confirm(form, commit)
          }}
        />
      )}
    </Section>
  )
}

function Section({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="spec-heading" className="flex flex-col gap-4">
      <h2 id="spec-heading" className="text-lg">
        배포 설정
      </h2>
      {children}
    </section>
  )
}

// 초안과 저장은 같은 레포 확인을 거치므로 같은 오류가 온다. 접수 뒤 레포가 바뀌어 commit이 없어진 경우만 따로 안내한다.
function failureOfDeploy(error: unknown): Failure | 'commit-gone' {
  if (error instanceof ApiError && error.code === 'COMMIT_NOT_FOUND') return 'commit-gone'
  return failureOf(error)
}

function FailureNotice({ failure, title }: { failure: Failure | 'commit-gone'; title: string }) {
  if (failure === 'commit-gone') {
    return (
      <Alert title="접수한 뒤 레포가 바뀌었어요">
        확인했던 commit을 레포에서 찾을 수 없어요. 레포를 다시 확인해 주세요.
      </Alert>
    )
  }
  return <RepoFailureAlert failure={failure} title={failure === 'unavailable' || failure === 'unknown' ? title : undefined} />
}

// 오류 안내와 그 뒤의 행동. commit이 사라졌으면 확인부터 다시, 다시 시도하면 될 수 있는 오류에는 onRetry가 있을 때만 다시 시도 버튼을 둔다.
function FailureBlock({ failure, title, onRecheck, onRetry }: { failure: Failure | 'commit-gone'; title: string; onRecheck: () => void; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <FailureNotice failure={failure} title={title} />
      {failure === 'commit-gone' ? (
        <Button variant="outline" onClick={onRecheck}>
          레포 다시 확인하기
        </Button>
      ) : (
        onRetry &&
        isRetryable(failure) && (
          <Button variant="outline" onClick={onRetry}>
            다시 시도하기
          </Button>
        )
      )}
    </div>
  )
}

type EditorProps = {
  draft: DeploySpecDraft
  form: SpecForm
  dockerfiles: string[]
  issues: Issue[]
  saving: boolean
  saveFailure: Failure | 'commit-gone' | null
  onEdit: (form: SpecForm) => void
  onRecheck: () => void
  onConfirm: () => void
}

function Editor({ draft, form, dockerfiles, issues, saving, saveFailure, onEdit, onRecheck, onConfirm }: EditorProps) {
  const map = issueMap(issues)
  const extra = withoutField(issues)
  // 초안이 자동으로 정하지 못해 사용자가 골라야 하는 칸이 있는지. 초안은 규칙 코드가 채운다.
  const needsPick = form.services.some((s) => Object.values(s.hints).some((hint) => hint?.review))
  return (
    <>
      <p className="text-sm text-muted">읽어 낸 값으로 미리 채웠어요. 틀린 칸은 직접 고칠 수 있어요.</p>
      {needsPick && <Banner variant="warn">자동으로 정하지 못한 칸이 있어요. 칸 아래 안내를 보고 골라 주세요.</Banner>}
      {draft.truncated && (
        <Alert variant="warn" title="레포가 커서 일부만 확인했어요">
          찾은 폴더가 전부가 아닐 수 있어요. 락 파일이나 Dockerfile이 없다고 말할 수 없으니 아래 값을 꼭 확인해 주세요.
        </Alert>
      )}
      {draft.projects.length === 0 && (
        <p className="text-sm">Node 프로젝트(package.json)를 찾지 못했어요.{dockerfiles.length > 0 ? ' Dockerfile이 있으면 서비스를 직접 추가할 수 있어요.' : ''}</p>
      )}
      {draft.projects.length > MAX_SERVICES && (
        <p className="text-sm text-muted">폴더를 {draft.projects.length}개 찾았어요. 서비스는 최대 3개라서 처음 3개로 시작했어요. 다른 폴더는 아래에서 추가할 수 있어요.</p>
      )}

      <SpecFormFields form={form} projects={draft.projects} dockerfiles={dockerfiles} issues={map} disabled={saving} onChange={onEdit} />

      {issues.length > 0 && (
        <Alert title={`${issues.length}곳을 고쳐 주세요`}>
          <p>표시된 칸을 고친 뒤 다시 확정해 주세요.</p>
          {extra.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {extra.map((i) => (
                <li key={i.path}>
                  <code className="font-mono">{i.path}</code>: {issueText(i.code)}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      {saveFailure && <FailureBlock failure={saveFailure} title="저장하지 못했어요" onRecheck={onRecheck} />}

      <div>
        <Button onClick={onConfirm} disabled={saving} aria-busy={saving}>
          {saving ? '저장하는 중…' : '배포 설정 확정'}
        </Button>
      </div>
    </>
  )
}

export default DeployConfirm
