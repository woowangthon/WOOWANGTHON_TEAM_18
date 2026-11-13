import { useState } from 'react'
import type { FormEvent } from 'react'
import PasswordField from '../components/PasswordField.tsx'
import { Alert } from '../components/ui/Alert.tsx'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Spinner } from '../components/ui/Spinner.tsx'
import { ApiError } from '../lib/api.ts'
import { failureOf } from '../pages/repo-failure.ts'
import { secretIssueText } from './secrets.ts'
import type { SecretEntry, SecretTarget } from './secrets.ts'

// 비밀값 입력 화면(#83)의 입력 폼. 부모가 계약에 맞춰 보내고(onSubmit), 서비스마다의 상태(done)를 알려 준다.
type SecretFormProps = {
  services: SecretTarget[]
  // 제출한다. 아직 들어가지 않은 서비스(와 값을 바꾸려는 서비스)의 key를 모두 받는다. 서버가 받았다고 답하면 resolve하고,
  // 못 보냈으면 reject한다. 400 INVALID_SECRETS의 fields는 칸마다 보이고, 503이나 네트워크 오류는 "사용자 잘못이 아님"으로 보인다.
  // reject하기 전에 부모가 서버의 상태를 다시 읽어 services에 반영해 두는 것이 좋다(서비스를 차례로 쓰다 중간에 실패할 수 있다).
  onSubmit: (entries: SecretEntry[]) => Promise<void>
}

// 값과 오류 칸을 가르는 식별자. 서비스 이름(소문자 · 숫자 · `-`)과 env 이름에는 `/`가 못 들어가므로 겹치지 않는다.
const idOf = (service: string, key: string) => `${service}/${key}`

type Failure = 'unavailable' | 'failed'

// record에서 id가 drop인 항목을 뺀다.
const omit = (record: Record<string, string>, drop: (id: string) => boolean) =>
  Object.fromEntries(Object.entries(record).filter(([id]) => !drop(id)))

// 값은 이 컴포넌트의 state에만 둔다. localStorage · URL · 콘솔 · 오류 문구로 내보내지 않는다.
function SecretForm({ services, onSubmit }: SecretFormProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  // 사용자가 값을 바꾸려고 연 서비스(이미 들어가 있어도 전체를 다시 입력한다).
  const [editing, setEditing] = useState<string[]>([])
  // 칸 오류. 클라이언트가 막은 빈 값과 서버가 알려 준 문제를 같은 자리에 둔다. 값: 서버 코드(클라이언트가 막은 빈 값은 REQUIRED).
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)

  // 서버에 들어간 서비스의 값은 화면 상태에도 남기지 않는다(중간 실패 뒤 다시 읽은 결과로 들어간 경우를 포함).
  // services가 바뀐 렌더에서 곧바로 정리한다(effect에서 setState하지 않는 React의 "렌더 중 상태 조정" 방식).
  const [seen, setSeen] = useState(services)
  if (seen !== services) {
    setSeen(services)
    const stale = services
      .filter((s) => s.done && !editing.includes(s.service))
      .flatMap((s) => s.keys.map((key) => idOf(s.service, key)))
    if (stale.some((id) => id in values)) {
      setValues(omit(values, (id) => stale.includes(id)))
    }
  }

  const active = services.filter((s) => !s.done || editing.includes(s.service))
  const pending = active.flatMap(({ service, keys }) => keys.map((key) => ({ service, key, id: idOf(service, key) })))

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const entries = pending.map(({ service, key, id }) => ({ service, key, value: values[id] ?? '' }))
    // 서버는 비어 있거나 공백뿐인 값을 받지 않는다. 보낼 값은 다듬지 않는다(앞뒤 공백도 값이다).
    const blanks = pending.filter(({ id }) => (values[id] ?? '').trim() === '')
    // 지난 시도의 실패 안내("값은 그대로 남아 있어요")를 먼저 거둔다. 비어 있는 칸을 막는 경우에도 낡은 안내가 남지 않게.
    setFailure(null)
    setIssues(Object.fromEntries(blanks.map(({ id }) => [id, 'REQUIRED'])))
    if (blanks.length > 0) return

    setSubmitting(true)
    try {
      await onSubmit(entries)
      // 서버에 넘어갔으면 화면에도 남기지 않는다.
      setValues({})
      setEditing([])
    } catch (error) {
      // 값은 그대로 둔다. 다시 보내려고 처음부터 치지 않아도 된다.
      const fields = error instanceof ApiError && error.code === 'INVALID_SECRETS' ? error.fields : []
      // 경로는 secrets.<서비스>.<KEY>. 칸에 닿지 않는 오류(secrets · secrets.<서비스>)는 일반 안내로 보인다.
      const byKey: Record<string, string> = {}
      for (const { path, code } of fields) {
        const [, service, key] = path.split('.')
        if (service && key && pending.some((p) => p.id === idOf(service, key))) byKey[idOf(service, key)] = code
      }
      setIssues(byKey)
      if (Object.keys(byKey).length === 0) setFailure(failureOf(error) === 'unavailable' ? 'unavailable' : 'failed')
    } finally {
      setSubmitting(false)
    }
  }

  function edit(service: string, open: boolean) {
    setEditing((current) => (open ? [...current, service] : current.filter((s) => s !== service)))
    if (!open) {
      const keys = services.find((s) => s.service === service)?.keys ?? []
      const own = (id: string) => keys.some((key) => id === idOf(service, key))
      setValues((current) => omit(current, own))
      setIssues((current) => omit(current, own))
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void handleSubmit(event)
      }}
      aria-label="비밀값 입력"
      className="flex flex-col gap-4"
    >
      <p className="text-sm text-muted">
        한 번 넣은 값은 서버가 다시 보여 주지 않아요. 서비스의 값을 바꾸려면 그 서비스의 값을 모두 다시 넣어 주세요.
      </p>
      {failure === 'unavailable' && (
        <Alert variant="warn" title="지금은 값을 저장할 수 없어요">
          사용자 잘못이 아니에요. 잠시 뒤에 다시 시도해 주세요. 입력한 값은 그대로 남아 있어요.
        </Alert>
      )}
      {failure === 'failed' && (
        <Alert title="값을 저장하지 못했어요">
          잠시 뒤에 다시 시도해 주세요. 입력한 값은 그대로 남아 있어요.
        </Alert>
      )}
      {services.map(({ service, keys, done }) => {
        const open = !done || editing.includes(service)
        return (
          <fieldset key={service} className="flex flex-col gap-3 rounded-md border border-line p-4">
            <legend className="flex items-center gap-2 px-1 text-sm font-bold">
              <span className="font-mono">{service}</span>
              {done && <Badge variant="ok">들어감</Badge>}
            </legend>
            {open ? (
              keys.map((key) => {
                const id = idOf(service, key)
                return (
                  <PasswordField
                    key={key}
                    label={key}
                    autoComplete="new-password"
                    placeholder="값"
                    value={values[id] ?? ''}
                    onChange={(value) => {
                      setValues((current) => ({ ...current, [id]: value }))
                      setIssues((current) => omit(current, (x) => x === id))
                    }}
                    error={issues[id] ? secretIssueText(issues[id]) : undefined}
                    disabled={submitting}
                  />
                )
              })
            ) : (
              <ul className="font-mono text-sm">
                {keys.map((key) => (
                  <li key={key}>{key}</li>
                ))}
              </ul>
            )}
            {done && (
              <Button
                variant="outline"
                className="self-start"
                aria-label={`${service} 값 ${open ? '바꾸기 취소' : '바꾸기'}`}
                onClick={() => {
                  edit(service, !open)
                }}
                disabled={submitting}
              >
                {open ? '취소' : '값 바꾸기'}
              </Button>
            )}
          </fieldset>
        )
      })}
      {pending.length > 0 && (
        <Button type="submit" className="gap-2 self-start" disabled={submitting} aria-busy={submitting}>
          {submitting && <Spinner size="sm" aria-hidden="true" />}
          {submitting ? '저장하는 중…' : '비밀값 저장'}
        </Button>
      )}
    </form>
  )
}

export default SecretForm
