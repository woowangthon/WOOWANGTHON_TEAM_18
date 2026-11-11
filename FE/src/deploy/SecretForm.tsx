import { useState } from 'react'
import type { FormEvent } from 'react'
import PasswordField from '../components/PasswordField.tsx'
import { Alert } from '../components/ui/Alert.tsx'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { failureOf } from '../pages/repo-failure.ts'
import type { SecretEntry, SecretTarget } from './secrets.ts'

// 비밀값 입력 화면(#83)의 입력 폼. 요청 · 응답 모양은 #43의 계약이 정해야 하므로 여기서는 모른다.
// 부모가 계약에 맞춰 보내고(onSubmit), key마다의 상태(pending · in · missing)를 services로 알려 준다.
type SecretFormProps = {
  services: SecretTarget[]
  // 제출한다. 아직 필요한 key(state가 in이 아닌 것)의 값만 받는다. 서버가 받았다고 답하면 resolve하고,
  // 못 보냈으면 reject한다. 503이나 네트워크 오류는 "사용자 잘못이 아님"으로 보인다.
  // resolve하기 전에 부모가 services의 state를 서버 응답대로 바꿔 둔다.
  onSubmit: (entries: SecretEntry[]) => Promise<void>
}

// 값과 오류 칸을 가르는 식별자. 서비스 이름(소문자 · 숫자 · `-`)과 env 이름에는 `/`가 못 들어가므로 겹치지 않는다.
const idOf = (service: string, key: string) => `${service}/${key}`

type Failure = 'unavailable' | 'failed'

// 값은 이 컴포넌트의 state에만 둔다. localStorage · URL · 콘솔 · 오류 문구로 내보내지 않는다.
function SecretForm({ services, onSubmit }: SecretFormProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [empty, setEmpty] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)

  const pending = services.flatMap(({ service, keys }) =>
    keys.filter((key) => key.state !== 'in').map((key) => ({ service, key: key.name, id: idOf(service, key.name) })),
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const entries = pending.map(({ service, key, id }) => ({ service, key, value: values[id] ?? '' }))
    const blanks = pending.filter(({ id }) => (values[id] ?? '') === '').map(({ id }) => id)
    // 지난 시도의 실패 안내("값은 그대로 남아 있어요")를 먼저 거둔다. 비어 있는 칸을 막는 경우에도 낡은 안내가 남지 않게.
    setFailure(null)
    setEmpty(blanks)
    if (blanks.length > 0) return

    setSubmitting(true)
    try {
      await onSubmit(entries)
      // 서버에 넘어갔으면 화면에도 남기지 않는다. 빠진 key는 다시 입력받는다.
      setValues({})
    } catch (error) {
      // 값은 그대로 둔다. 다시 보내려고 처음부터 치지 않아도 된다.
      setFailure(failureOf(error) === 'unavailable' ? 'unavailable' : 'failed')
    } finally {
      setSubmitting(false)
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
        한 번 넣은 값은 서버가 다시 보여 주지 않아요. 잘못 넣었다면 같은 칸에 다시 넣어 주세요.
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
      {services.map(({ service, keys }) => (
        <fieldset key={service} className="flex flex-col gap-3 rounded-md border border-line p-3">
          <legend className="px-1 font-mono text-sm font-bold">{service}</legend>
          {keys.map(({ name: key, state }) => {
            const id = idOf(service, key)
            if (state === 'in') {
              return (
                <div key={key} className="flex items-center gap-2 text-sm">
                  <span className="font-mono">{key}</span>
                  <Badge variant="ok">들어감</Badge>
                </div>
              )
            }
            const error = empty.includes(id)
              ? '값을 입력해 주세요'
              : state === 'missing'
                ? '서버에 들어가지 않았어요. 다시 입력해 주세요'
                : undefined
            return (
              <PasswordField
                key={key}
                label={key}
                autoComplete="new-password"
                placeholder="값"
                value={values[id] ?? ''}
                onChange={(value) => {
                  setValues((current) => ({ ...current, [id]: value }))
                  setEmpty((current) => current.filter((x) => x !== id))
                }}
                error={error}
                disabled={submitting}
              />
            )
          })}
        </fieldset>
      ))}
      {pending.length > 0 && (
        <Button type="submit" className="self-start" disabled={submitting} aria-busy={submitting}>
          {submitting ? '저장하는 중…' : '비밀값 저장'}
        </Button>
      )}
    </form>
  )
}

export default SecretForm
