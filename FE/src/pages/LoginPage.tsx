import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import AuthCard from '../auth/AuthCard.tsx'
import { emailError } from '../auth/form-rules.ts'
import { readLoginState } from '../auth/login-state.ts'
import { verifyRedirectTo } from '../auth/redirects.ts'
import PasswordField from '../components/PasswordField.tsx'
import { Alert } from '../components/ui/Alert.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Field } from '../components/ui/Field.tsx'
import { supabase } from '../lib/supabase.ts'

type Notice = 'invalid' | 'rate' | 'unverified' | 'failed'
type Resend = 'idle' | 'sending' | 'sent' | 'rate' | 'failed'

// 원래 보던 화면을 모를 때 로그인 뒤 갈 곳.
const AFTER_LOGIN = '/dashboard'
const RATE_LIMIT_LOCK_MS = 60_000

// 오류는 메시지 문장이 아니라 코드와 상태로 구분한다. 모르는 오류는 'failed'로 떨어진다.
function classify(error: { code?: string; status?: number }): Notice {
  if (error.code === 'invalid_credentials') return 'invalid'
  if (error.code === 'email_not_confirmed') return 'unverified'
  if (error.status === 429) return 'rate'
  return 'failed'
}

function validate(email: string, password: string) {
  const errors: { email?: string; password?: string } = {}
  const emailProblem = emailError(email)
  if (emailProblem) errors.email = emailProblem
  if (password === '') errors.password = '비밀번호를 입력해 주세요'
  return errors
}

function LoginPage() {
  const navigate = useNavigate()
  // 보호된 화면에서 튕겨 왔다면 돌아갈 곳(from)과, 세션이 저절로 끝났는지(expired)를 안다.
  const { from, expired } = readLoginState(useLocation().state)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [locked, setLocked] = useState(false)
  const [resend, setResend] = useState<Resend>('idle')
  // 인증 안 됨으로 확인된 주소. 안내가 떠 있는 동안 입력칸을 고쳐도 재발송은 이 주소로 간다.
  const [unverifiedEmail, setUnverifiedEmail] = useState('')
  const lockTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // 화면을 떠난 뒤에 잠금 타이머가 상태를 바꾸지 않게 한다.
  useEffect(() => () => clearTimeout(lockTimer.current), [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = email.trim()
    const found = validate(trimmed, password)
    setErrors(found)
    if (found.email || found.password) return

    setNotice(null)
    setResend('idle')
    setSubmitting(true)
    let result: Notice | 'ok'
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      })
      result = error ? classify(error) : 'ok'
    } catch {
      result = 'failed'
    }
    setSubmitting(false)

    if (result === 'ok') {
      void navigate(from ?? AFTER_LOGIN, { replace: true })
      return
    }
    setNotice(result)
    if (result === 'unverified') setUnverifiedEmail(trimmed)
    if (result === 'rate') {
      setLocked(true)
      lockTimer.current = setTimeout(() => {
        setLocked(false)
        // 잠금이 풀리면 "1분 뒤에 다시"라는 안내도 거둔다. 다른 안내는 그대로 둔다.
        setNotice((current) => (current === 'rate' ? null : current))
      }, RATE_LIMIT_LOCK_MS)
    }
  }

  async function handleResend() {
    setResend('sending')
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: unverifiedEmail,
        options: { emailRedirectTo: verifyRedirectTo() },
      })
      if (!error) setResend('sent')
      else setResend(error.status === 429 ? 'rate' : 'failed')
    } catch {
      setResend('failed')
    }
  }

  return (
    <AuthCard>
      <h1 className="text-xl">{expired ? '다시 로그인해 주세요' : '로그인'}</h1>

      {expired && (
        <Alert variant="info" title="로그인 시간이 지났어요">
          안전을 위해 오랫동안 쓰지 않으면 로그인이 풀려요. 다시 로그인하면 하던 곳으로
          돌아가요.
        </Alert>
      )}

      {notice === 'invalid' && (
        <Alert title="이메일 또는 비밀번호가 올바르지 않아요">
          입력한 내용을 다시 확인해 주세요. 계속 안 되면 비밀번호를 다시 설정할 수 있어요.
        </Alert>
      )}
      {notice === 'rate' && (
        <Alert variant="warn" title="시도가 많아서 잠시 쉬어요">
          약 1분 뒤에 다시 시도해 주세요. 그동안 버튼이 잠겨요.
        </Alert>
      )}
      {notice === 'failed' && (
        <Alert title="로그인 서버에 연결하지 못했어요">
          잠시 후 다시 시도해 주세요.
        </Alert>
      )}
      {notice === 'unverified' && (
        <Alert variant="info" title="이메일 인증이 아직 안 됐어요">
          <div className="flex flex-col gap-2">
            <p>
              가입할 때 보낸 메일의 링크를 눌러 주세요. 몇 분 걸릴 수 있어요. 스팸함도 확인해
              주세요.
            </p>
            <div>
              <Button
                variant="outline"
                onClick={() => {
                  void handleResend()
                }}
                disabled={resend === 'sending' || resend === 'sent'}
              >
                인증 메일 다시 보내기
              </Button>
            </div>
            {resend === 'sent' && <p role="status">인증 메일을 다시 보냈어요.</p>}
            {resend === 'rate' && (
              <p role="status">잠시 후 다시 시도해 주세요. 메일은 시간당 몇 통만 보낼 수 있어요.</p>
            )}
            {resend === 'failed' && (
              <p role="status">메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.</p>
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
            autoComplete="current-password"
            placeholder="비밀번호"
            value={password}
            onChange={setPassword}
            error={errors.password}
            disabled={submitting}
          />
          <Link to="/reset-password" className="self-start text-sm underline">
            비밀번호를 잊으셨나요?
          </Link>
        </div>
        <Button
          type="submit"
          className="w-full"
          disabled={submitting || locked}
          aria-busy={submitting}
        >
          {submitting ? '로그인하는 중…' : expired ? '로그인하고 돌아가기' : '로그인'}
        </Button>
        {submitting && (
          <p role="status" className="text-sm text-muted">
            입력은 잠겨 있어요. 보통 1~2초 걸려요.
          </p>
        )}
      </form>

      <p className="text-sm text-muted">
        계정이 없으신가요?{' '}
        <Link to="/signup" className="font-bold text-fg underline">
          회원가입
        </Link>
      </p>
    </AuthCard>
  )
}

export default LoginPage
