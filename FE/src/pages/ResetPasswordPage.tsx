import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import AuthCard from '../auth/AuthCard.tsx'
import { confirmError, emailError, passwordError } from '../auth/form-rules.ts'
import { classifyMailError, mailFailureCopy } from '../auth/mail-error.ts'
import type { MailFailure } from '../auth/mail-error.ts'
import PasswordRules from '../auth/PasswordRules.tsx'
import { useAuth } from '../auth/useAuth.ts'
import { useCooldown } from '../auth/useCooldown.ts'
import PasswordField from '../components/PasswordField.tsx'
import { Alert } from '../components/ui/Alert.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Field } from '../components/ui/Field.tsx'
import { supabase } from '../lib/supabase.ts'

// request: 주소 입력(R1), sent: 메일 안내(R2), checking: 메일 링크로 들어와 확인 중,
// new-password: 새 비밀번호(R3), expired: 링크를 쓸 수 없음(R4), done: 완료(R5)
type Mode = 'request' | 'sent' | 'checking' | 'new-password' | 'expired' | 'done'
type Resend = 'idle' | 'sending' | 'sent' | MailFailure
type PasswordErrors = { password?: string; confirm?: string }

const RESEND_COOLDOWN_SECONDS = 60

// 메일의 링크로 들어왔을 때 주소에 무엇이 담겨 오는지로 시작 화면을 정한다.
// 링크가 통하면 비밀번호 재설정용 토큰이 해시에 있고(type=recovery), 안 통하면 오류가 쿼리나 해시에 있다.
function startMode(search: string, hash: string): Mode {
  const params = [new URLSearchParams(search), new URLSearchParams(hash.replace(/^#/, ''))]
  const has = (name: string) => params.some((p) => p.has(name))
  if (has('error') || has('error_code') || has('error_description')) return 'expired'
  if (params.some((p) => p.get('type') === 'recovery')) return 'checking'
  return 'request'
}

// 새 비밀번호를 저장하려는데 재설정 세션이 이미 없는 경우.
function isSessionGone(error: { code?: string; status?: number; name?: string }) {
  return (
    error.status === 401 ||
    error.code === 'session_not_found' ||
    error.code === 'session_expired' ||
    error.name === 'AuthSessionMissingError'
  )
}

const resetRedirectTo = () => `${window.location.origin}/reset-password`

function BackToLogin() {
  return (
    <p className="text-sm text-muted">
      <Link to="/login" className="underline">
        ← 로그인으로 돌아가기
      </Link>
    </p>
  )
}

function ResetPasswordPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const [mode, setMode] = useState<Mode>(() => startMode(location.search, location.hash))

  // 주소 입력(R1) · 메일 안내(R2)
  const [email, setEmail] = useState('')
  const [emailProblem, setEmailProblem] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<MailFailure | null>(null)
  const [sentTo, setSentTo] = useState('')
  const [resend, setResend] = useState<Resend>('idle')
  const cooldown = useCooldown()

  // 새 비밀번호(R3)
  const [accountEmail, setAccountEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<PasswordErrors>({})
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  useEffect(() => {
    if (mode !== 'checking') return
    let ignore = false
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (ignore) return
        // 링크가 통했으면 supabase-js가 주소의 토큰을 지우고 세션을 저장한다. 토큰이 남아 있으면 쓰지 못한 링크다.
        // 이미 로그인해 있던 세션이 있어도 링크가 안 통한 것을 새 비밀번호 화면으로 바꾸지 않는다.
        const linkWorked = !window.location.hash.includes('access_token')
        if (data.session && linkWorked) {
          setAccountEmail(data.session.user.email ?? '')
          setMode('new-password')
        } else {
          setMode('expired')
        }
      })
      .catch(() => {
        if (!ignore) setMode('expired')
      })
    return () => {
      ignore = true
    }
  }, [mode])

  // 메일을 보내는 호출. 없는 주소여도 Supabase는 성공처럼 답하고, 화면도 같은 안내를 보인다(계정 유무를 알려 주지 않으려고).
  async function sendMail(to: string): Promise<MailFailure | 'ok'> {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(to, {
        redirectTo: resetRedirectTo(),
      })
      return error ? classifyMailError(error) : 'ok'
    } catch {
      return 'failed'
    }
  }

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = email.trim()
    const problem = emailError(trimmed)
    setEmailProblem(problem)
    setNotice(null)
    if (problem) return

    setSubmitting(true)
    const result = await sendMail(trimmed)
    setSubmitting(false)
    if (result === 'ok') {
      setSentTo(trimmed)
      setResend('idle')
      cooldown.start(RESEND_COOLDOWN_SECONDS)
      setMode('sent')
    } else {
      setNotice(result)
    }
  }

  async function handleResend() {
    setResend('sending')
    const result = await sendMail(sentTo)
    setResend(result === 'ok' ? 'sent' : result)
    // 보냈든 한도에 걸렸든 바로 다시 누르게 두지 않는다.
    if (result === 'ok' || result === 'rate') cooldown.start(RESEND_COOLDOWN_SECONDS)
  }

  async function handleNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found: PasswordErrors = {
      password: passwordError(password, accountEmail),
      confirm: confirmError(password, confirm),
    }
    setErrors(found)
    setSaveFailed(false)
    if (found.password || found.confirm) return

    setSaving(true)
    let failure: { code?: string; status?: number; name?: string } | null = null
    try {
      const { error } = await supabase.auth.updateUser({ password })
      failure = error
    } catch {
      failure = {}
    }
    if (!failure) {
      // 재설정 링크로 얻은 세션은 여기서 끝낸다. 새 비밀번호로 직접 로그인하게 한다.
      // 로그아웃에 실패해도 비밀번호는 이미 바뀌었으니 완료로 본다.
      try {
        await signOut()
      } catch {
        // 위 이유로 무시한다.
      }
    }
    setSaving(false)

    if (!failure) setMode('done')
    else if (isSessionGone(failure)) setMode('expired')
    else if (failure.code === 'same_password') {
      setErrors({ password: '이전과 다른 비밀번호를 써 주세요' })
    } else if (failure.code === 'weak_password') {
      setErrors({ password: '더 안전한 비밀번호를 써 주세요. 더 길게 하거나 문자를 섞어 보세요' })
    } else setSaveFailed(true)
  }

  if (mode === 'checking') {
    return (
      <AuthCard>
        <p role="status" className="text-sm text-muted">
          링크를 확인하는 중…
        </p>
      </AuthCard>
    )
  }

  if (mode === 'expired') {
    return (
      <AuthCard>
        <div className="flex flex-col gap-2">
          <h1 className="text-xl">링크가 만료됐거나 이미 사용했어요</h1>
          <p className="text-sm text-muted">
            재설정 링크는 한 번만, 한 시간 안에 쓸 수 있어요. 새 링크를 받아 주세요.
          </p>
        </div>
        <Button
          className="w-full"
          onClick={() => {
            setMode('request')
          }}
        >
          새 링크 받기
        </Button>
        <BackToLogin />
      </AuthCard>
    )
  }

  if (mode === 'done') {
    return (
      <AuthCard>
        <div className="flex flex-col gap-2">
          <h1 className="text-xl">비밀번호를 바꿨어요</h1>
          <p className="text-sm text-muted">새 비밀번호로 로그인해 주세요.</p>
        </div>
        <Button
          className="w-full"
          onClick={() => {
            void navigate('/login')
          }}
        >
          로그인하러 가기
        </Button>
      </AuthCard>
    )
  }

  if (mode === 'new-password') {
    return (
      <AuthCard>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl">새 비밀번호 설정</h1>
          <p className="text-sm text-muted">메일의 링크로 들어왔어요. 새 비밀번호를 정해 주세요.</p>
        </div>

        {saveFailed && (
          <Alert title="비밀번호를 바꾸지 못했어요">잠시 후 다시 시도해 주세요.</Alert>
        )}

        <form
          noValidate
          onSubmit={(event) => {
            void handleNewPassword(event)
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <PasswordField
              label="새 비밀번호"
              autoComplete="new-password"
              placeholder="새 비밀번호"
              value={password}
              onChange={setPassword}
              error={errors.password}
              disabled={saving}
            />
            <PasswordRules password={password} email={accountEmail} />
          </div>
          <PasswordField
            label="새 비밀번호 확인"
            autoComplete="new-password"
            placeholder="한 번 더"
            value={confirm}
            onChange={setConfirm}
            error={errors.confirm}
            disabled={saving}
          />
          <Button type="submit" className="w-full" disabled={saving} aria-busy={saving}>
            {saving ? '바꾸는 중…' : '비밀번호 바꾸기'}
          </Button>
        </form>
      </AuthCard>
    )
  }

  if (mode === 'sent') {
    const resendFailure =
      resend === 'idle' || resend === 'sending' || resend === 'sent' ? null : resend
    return (
      <AuthCard>
        <div className="flex flex-col gap-2">
          <h1 className="text-xl">메일을 확인해 주세요</h1>
          <p className="text-sm">
            <b>{sentTo}</b> 로 가입한 계정이 있다면 재설정 링크가 도착해요. 몇 분 걸릴 수 있어요.
          </p>
        </div>

        <Alert variant="info" title="메일이 안 오나요?">
          스팸함을 확인하거나, 이메일 주소가 맞는지 다시 확인해 보세요.
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
            {cooldown.remaining > 0 ? `메일 다시 보내기 (${cooldown.remaining}초 뒤)` : '메일 다시 보내기'}
          </Button>
          {resend === 'sent' && (
            <p role="status" className="text-sm">
              메일을 다시 보냈어요.
            </p>
          )}
          {resendFailure && (
            <p role="status" className="text-sm">
              {mailFailureCopy[resendFailure].title}. {mailFailureCopy[resendFailure].body}
            </p>
          )}
          <Button
            variant="outline"
            onClick={() => {
              setMode('request')
            }}
            className="w-full"
          >
            이메일 주소 바꾸기
          </Button>
        </div>
        <p className="text-sm text-muted">링크는 한 시간 동안 유효해요. 같은 주소로 여러 번 보내면 한도에 걸릴 수 있어요.</p>
        <BackToLogin />
      </AuthCard>
    )
  }

  return (
    <AuthCard>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl">비밀번호 재설정</h1>
        <p className="text-sm text-muted">가입한 이메일을 입력하면 재설정 링크를 보내 드려요.</p>
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
          void handleRequest(event)
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
          error={emailProblem}
          disabled={submitting}
        />
        <Button type="submit" className="w-full" disabled={submitting} aria-busy={submitting}>
          {submitting ? '보내는 중…' : '재설정 링크 보내기'}
        </Button>
      </form>

      <BackToLogin />
    </AuthCard>
  )
}

export default ResetPasswordPage
