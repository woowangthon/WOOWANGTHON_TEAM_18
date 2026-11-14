import { useState } from 'react'
import type { FormEvent } from 'react'
import { confirmError, passwordError, WEAK_PASSWORD_ERROR } from '../auth/form-rules.ts'
import { isDemoAccount } from '../auth/demo-accounts.ts'
import PasswordRules from '../auth/PasswordRules.tsx'
import NoticeBanner from '../components/NoticeBanner.tsx'
import PasswordField from '../components/PasswordField.tsx'
import { Button } from '../components/ui/Button.tsx'
import { LockIcon } from '../components/ui/Icons.tsx'
import { supabase } from '../lib/supabase.ts'
import ProfileSection from './ProfileSection.tsx'

type Errors = { current?: string; password?: string; confirm?: string }
type Notice = 'rate' | 'failed'

// 오류는 메시지 문장이 아니라 코드와 상태로 구분한다.
const SAME_PASSWORD_ERROR = '현재 비밀번호와 다른 비밀번호를 써 주세요'
const WRONG_CURRENT_ERROR = '현재 비밀번호가 맞지 않아요'

function PasswordSection({ email }: { email: string }) {
  const locked = isDemoAccount(email)
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDone(false)
    setNotice(null)
    const found: Errors = {
      current: current === '' ? '현재 비밀번호를 입력해 주세요' : undefined,
      password:
        passwordError(password, email) ??
        (password === current && current !== '' ? SAME_PASSWORD_ERROR : undefined),
      confirm: confirmError(password, confirm),
    }
    setErrors(found)
    if (found.current || found.password || found.confirm) return

    setSubmitting(true)
    try {
      // 현재 비밀번호를 다시 확인한 뒤에만 바꾼다(열어 둔 화면을 다른 사람이 쓰는 경우를 막는다).
      const check = await supabase.auth.signInWithPassword({ email, password: current })
      if (check.error) {
        if (check.error.code === 'invalid_credentials') setErrors({ current: WRONG_CURRENT_ERROR })
        else setNotice(check.error.status === 429 ? 'rate' : 'failed')
        return
      }
      const update = await supabase.auth.updateUser({ password })
      if (update.error) {
        if (update.error.code === 'weak_password') setErrors({ password: WEAK_PASSWORD_ERROR })
        else if (update.error.code === 'same_password') setErrors({ password: SAME_PASSWORD_ERROR })
        else setNotice(update.error.status === 429 ? 'rate' : 'failed')
        return
      }
      setCurrent('')
      setPassword('')
      setConfirm('')
      setDone(true)
    } catch {
      setNotice('failed')
    } finally {
      setSubmitting(false)
    }
  }

  const disabled = locked || submitting

  return (
    <ProfileSection id="password" title="비밀번호 변경" icon={<LockIcon width={20} height={20} />}>
      {locked && (
        <NoticeBanner variant="info" title="시연 계정은 비밀번호를 바꿀 수 없어요" />
      )}
      {done && <NoticeBanner variant="ok" title="비밀번호를 바꿨어요" />}
      {notice === 'rate' && (
        <NoticeBanner variant="warn" title="시도가 많아서 잠시 쉬어요">
          잠시 뒤에 다시 시도해 주세요.
        </NoticeBanner>
      )}
      {notice === 'failed' && (
        <NoticeBanner title="비밀번호를 바꾸지 못했어요">
          잠시 뒤에 다시 시도해 주세요. 비밀번호는 바뀌지 않았어요.
        </NoticeBanner>
      )}
      <form
        noValidate
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
        className="flex flex-col gap-4"
      >
        <PasswordField
          label="현재 비밀번호"
          autoComplete="current-password"
          placeholder="현재 비밀번호"
          value={current}
          onChange={setCurrent}
          error={errors.current}
          disabled={disabled}
        />
        <div className="flex flex-col gap-2">
          <PasswordField
            label="새 비밀번호"
            autoComplete="new-password"
            placeholder="새 비밀번호"
            value={password}
            onChange={setPassword}
            error={errors.password}
            disabled={disabled}
          />
          <PasswordRules password={password} email={email} />
        </div>
        <PasswordField
          label="새 비밀번호 확인"
          autoComplete="new-password"
          placeholder="새 비밀번호를 한 번 더"
          value={confirm}
          onChange={setConfirm}
          error={errors.confirm}
          disabled={disabled}
        />
        <Button type="submit" className="self-start" disabled={disabled} aria-busy={submitting}>
          {submitting ? '바꾸는 중…' : '비밀번호 바꾸기'}
        </Button>
      </form>
    </ProfileSection>
  )
}

export default PasswordSection
