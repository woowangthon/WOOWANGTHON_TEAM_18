import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import AuthCard from '../auth/AuthCard.tsx'
import { confirmError, emailError, passwordError } from '../auth/form-rules.ts'
import { classifyMailError, mailFailureCopy } from '../auth/mail-error.ts'
import type { MailFailure } from '../auth/mail-error.ts'
import PasswordRules from '../auth/PasswordRules.tsx'
import { useCooldown } from '../auth/useCooldown.ts'
import PasswordField from '../components/PasswordField.tsx'
import { Alert } from '../components/ui/Alert.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Field } from '../components/ui/Field.tsx'
import { supabase } from '../lib/supabase.ts'

type Errors = { email?: string; password?: string; confirm?: string }
// 가입 호출만 돌려주는 오류를 더한다. 나머지는 메일 발송 오류와 같다.
type Notice = MailFailure | 'weak' | 'invalid-email'
type Resend = 'idle' | 'sending' | 'sent' | MailFailure

const RESEND_COOLDOWN_SECONDS = 60

function classify(error: { code?: string; status?: number }): Notice {
  if (error.code === 'weak_password') return 'weak'
  if (error.code === 'email_address_invalid') return 'invalid-email'
  return classifyMailError(error)
}

// 인증 링크로 돌아오면 로그인된 채로 프로필에서 GitHub 연동 안내를 만난다.
const emailRedirectTo = () => `${window.location.origin}/profile`

function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<MailFailure | null>(null)
  // 메일을 보낸 주소. 있으면 "메일을 확인해 주세요" 화면이다. 입력칸을 고쳐도 재발송은 이 주소로 간다.
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [resend, setResend] = useState<Resend>('idle')
  const cooldown = useCooldown()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = email.trim()
    const found: Errors = {
      email: emailError(trimmed),
      password: passwordError(password, trimmed),
      confirm: confirmError(password, confirm),
    }
    setErrors(found)
    setNotice(null)
    if (found.email || found.password || found.confirm) return

    setSubmitting(true)
    let result: Notice | 'ok'
    try {
      const { error } = await supabase.auth.signUp({
        email: trimmed,
        password,
        options: { emailRedirectTo: emailRedirectTo() },
      })
      result = error ? classify(error) : 'ok'
    } catch {
      result = 'failed'
    }
    setSubmitting(false)

    if (result === 'ok') {
      // 이미 가입된 주소여도 Supabase는 오류를 주지 않는다(계정이 있는지 알려 주지 않으려고). 같은 화면을 보여 준다.
      setSentTo(trimmed)
      setResend('idle')
      cooldown.start(RESEND_COOLDOWN_SECONDS)
    } else if (result === 'weak') {
      setErrors({ password: '더 안전한 비밀번호를 써 주세요. 더 길게 하거나 문자를 섞어 보세요' })
    } else if (result === 'invalid-email') {
      setErrors({ email: '올바른 이메일 형식이 아니에요. 예: name@example.com' })
    } else {
      setNotice(result)
    }
  }

  async function handleResend() {
    if (!sentTo) return
    setResend('sending')
    let result: MailFailure | 'ok'
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: sentTo,
        options: { emailRedirectTo: emailRedirectTo() },
      })
      result = error ? classifyMailError(error) : 'ok'
    } catch {
      result = 'failed'
    }
    setResend(result === 'ok' ? 'sent' : result)
    // 보냈든 한도에 걸렸든 바로 다시 누르게 두지 않는다.
    if (result === 'ok' || result === 'rate') cooldown.start(RESEND_COOLDOWN_SECONDS)
  }

  if (sentTo) {
    const resendFailure = resend === 'idle' || resend === 'sending' || resend === 'sent' ? null : resend
    return (
      <AuthCard>
        <div className="flex flex-col gap-2">
          <h1 className="text-xl">메일을 확인해 주세요</h1>
          <p className="text-sm">
            <b>{sentTo}</b> 로 확인 메일을 보냈어요. 몇 분 걸릴 수 있어요. 스팸함도 확인해 주세요.
          </p>
          <p className="text-sm text-muted">메일의 링크를 누르면 가입이 끝나고 로그인돼요.</p>
        </div>

        <Alert variant="info" title="메일이 안 오나요?">
          이미 가입한 주소라면 메일이 오지 않을 수 있어요.{' '}
          <Link to="/login" className="font-bold underline">
            로그인
          </Link>
          하거나{' '}
          <Link to="/reset-password" className="font-bold underline">
            비밀번호를 다시 설정
          </Link>
          해 보세요.
        </Alert>

        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void handleResend()
            }}
            disabled={resend === 'sending' || cooldown.remaining > 0}
            className="w-full"
          >
            {cooldown.remaining > 0
              ? `인증 메일 다시 보내기 (${cooldown.remaining}초 뒤)`
              : '인증 메일 다시 보내기'}
          </Button>
          {resend === 'sent' && <p role="status" className="text-sm">인증 메일을 다시 보냈어요.</p>}
          {resendFailure && (
            <p role="status" className="text-sm">
              {mailFailureCopy[resendFailure].title}. {mailFailureCopy[resendFailure].body}
            </p>
          )}
          <Button
            variant="outline"
            onClick={() => {
              setSentTo(null)
            }}
            className="w-full"
          >
            이메일 주소 바꾸기
          </Button>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl">회원가입</h1>
        <p className="text-sm text-muted">가입한 뒤 GitHub를 연동하면 배포를 요청할 수 있어요.</p>
      </div>

      {notice && (
        <Alert title={mailFailureCopy[notice].title}>
          <div className="flex flex-col gap-2">
            <p>{mailFailureCopy[notice].body}</p>
            {notice === 'not-authorized' && (
              <Link to="/login" className="font-bold underline">
                로그인으로 이동
              </Link>
            )}
          </div>
        </Alert>
      )}

      <form
        noValidate
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
        className="flex flex-col gap-4"
      >
        <Field
          label="이메일"
          type="email"
          autoComplete="email"
          placeholder="name@example.com"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
          }}
          error={errors.email}
          disabled={submitting}
        />
        <div className="flex flex-col gap-2">
          <PasswordField
            label="비밀번호"
            autoComplete="new-password"
            placeholder="비밀번호"
            value={password}
            onChange={setPassword}
            error={errors.password}
            disabled={submitting}
          />
          <PasswordRules password={password} email={email} />
        </div>
        <PasswordField
          label="비밀번호 확인"
          autoComplete="new-password"
          placeholder="비밀번호를 한 번 더"
          value={confirm}
          onChange={setConfirm}
          error={errors.confirm}
          disabled={submitting}
        />
        <Button type="submit" className="w-full" disabled={submitting} aria-busy={submitting}>
          {submitting ? '가입하는 중…' : '가입하기'}
        </Button>
      </form>

      <p className="text-sm text-muted">
        이미 계정이 있으신가요?{' '}
        <Link to="/login" className="font-bold text-fg underline">
          로그인
        </Link>
      </p>
    </AuthCard>
  )
}

export default SignupPage
