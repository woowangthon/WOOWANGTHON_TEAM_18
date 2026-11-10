import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/auth-context.ts'
import ResetPasswordPage from './ResetPasswordPage.tsx'

// 실제 Supabase를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  getSession: vi.fn(),
  updateUser: vi.fn(),
}))
vi.mock('../lib/supabase.ts', () => ({ supabase: { auth } }))
const signOut = vi.fn()

const ok = { data: {}, error: null }
const fail = (error: { code?: string; status?: number; name?: string }) => ({
  data: null,
  error: { message: 'x', ...error },
})
const sessionOf = (email = 'student@example.com') => ({
  data: { session: { user: { email } } },
  error: null,
})
const noSession = { data: { session: null }, error: null }

beforeEach(() => {
  auth.resetPasswordForEmail.mockReset()
  auth.getSession.mockReset()
  auth.updateUser.mockReset()
  signOut.mockReset()
  signOut.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  window.location.hash = ''
})

// 메일 링크로 돌아온 주소는 MemoryRouter의 시작 주소로 흉내 낸다.
// 실제로는 supabase-js가 토큰을 쓴 뒤 window의 해시를 지우므로 그쪽은 테스트가 따로 정한다.
const renderPage = (url = '/reset-password') =>
  render(
    <AuthContext.Provider value={{ state: { status: 'signedOut', expired: false }, signOut }}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/login" element={<p>login page</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )

const RECOVERY_URL = '/reset-password#access_token=abc&refresh_token=def&type=recovery'
const emailInput = () => screen.getByRole('textbox', { name: '이메일' })
const sendButton = () => screen.getByRole('button', { name: '재설정 링크 보내기' })
const resendButton = () => screen.getByRole('button', { name: /메일 다시 보내기/ })
const newPasswordInput = () => screen.getByLabelText('새 비밀번호')
const confirmInput = () => screen.getByLabelText('새 비밀번호 확인')
const changeButton = () => screen.getByRole('button', { name: '비밀번호 바꾸기' })
const flush = () =>
  act(async () => {
    await Promise.resolve()
  })
const tick = (seconds: number) => {
  for (let i = 0; i < seconds; i += 1) {
    act(() => {
      vi.advanceTimersByTime(1000)
    })
  }
}

// 링크가 통한 상태: 세션이 있고 supabase-js가 주소의 토큰을 지웠다(window 해시가 비어 있다).
const openFromRecoveryLink = async () => {
  auth.getSession.mockResolvedValue(sessionOf())
  renderPage(RECOVERY_URL)
  await screen.findByRole('heading', { name: '새 비밀번호 설정' })
}
const submitNewPassword = (password = 'abc12345', confirm = password) => {
  fireEvent.change(newPasswordInput(), { target: { value: password } })
  fireEvent.change(confirmInput(), { target: { value: confirm } })
  fireEvent.click(changeButton())
}

// R1 · R2: 메일 요청

it('R1: shows the request form with a way back to login', () => {
  renderPage()
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('비밀번호 재설정')
  expect(emailInput().getAttribute('type')).toBe('email')
  expect(screen.getByRole('link', { name: '← 로그인으로 돌아가기' }).getAttribute('href')).toBe(
    '/login',
  )
  expect(auth.getSession).not.toHaveBeenCalled()
})

it.each([
  ['', '이메일을 입력해 주세요'],
  ['student', '올바른 이메일 형식이 아니에요. 예: name@example.com'],
])('R1: rejects the address "%s" without calling the server', (value, message) => {
  renderPage()
  fireEvent.change(emailInput(), { target: { value } })
  fireEvent.click(sendButton())
  expect(screen.getByText(message)).toBeTruthy()
  expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
})

it('R2: sends the link back to /reset-password and shows the mail screen', async () => {
  auth.resetPasswordForEmail.mockResolvedValue(ok)
  renderPage()
  fireEvent.change(emailInput(), { target: { value: 'student@example.com' } })
  fireEvent.click(sendButton())
  await screen.findByRole('heading', { name: '메일을 확인해 주세요' })
  expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('student@example.com', {
    redirectTo: `${window.location.origin}/reset-password`,
  })
  // 가입된 주소인지는 알려 주지 않는다. 계정이 있다면 도착한다고만 말한다.
  expect(screen.getByText(/로 가입한 계정이 있다면 재설정 링크가 도착해요/)).toBeTruthy()
  expect(screen.getByText('student@example.com')).toBeTruthy()
  expect(screen.getByText('스팸함을 확인하거나, 이메일 주소가 맞는지 다시 확인해 보세요.')).toBeTruthy()
})

it('R1: locks the field and the button while sending', async () => {
  auth.resetPasswordForEmail.mockReturnValue(new Promise(() => undefined))
  renderPage()
  fireEvent.change(emailInput(), { target: { value: 'student@example.com' } })
  fireEvent.click(sendButton())
  const busy = await screen.findByRole('button', { name: '보내는 중…' })
  expect((busy as HTMLButtonElement).disabled).toBe(true)
  expect((emailInput() as HTMLInputElement).disabled).toBe(true)
})

it.each([
  [{ status: 429, code: 'over_email_send_rate_limit' }, '메일 발송이 몰렸어요', '잠시 후 다시 시도해 주세요.'],
  [
    { status: 400, code: 'email_address_not_authorized' },
    '이 주소로는 메일을 보낼 수 없어요',
    '제공된 테스트 계정으로 로그인해 주세요.',
  ],
  [{ status: 500 }, '서버에 연결하지 못했어요', '잠시 후 다시 시도해 주세요.'],
])('R1: a send error %j shows "%s" and stays on the form', async (error, title, body) => {
  auth.resetPasswordForEmail.mockResolvedValue(fail(error))
  renderPage()
  fireEvent.change(emailInput(), { target: { value: 'student@example.com' } })
  fireEvent.click(sendButton())
  expect(await screen.findByText(title)).toBeTruthy()
  expect(screen.getByText(body)).toBeTruthy()
  expect(screen.queryByRole('heading', { name: '메일을 확인해 주세요' })).toBeNull()
})

it('R1: a thrown send is the generic connection failure, and a team-outside address links to login', async () => {
  auth.resetPasswordForEmail.mockRejectedValueOnce(new Error('offline'))
  renderPage()
  fireEvent.change(emailInput(), { target: { value: 'student@example.com' } })
  fireEvent.click(sendButton())
  expect(await screen.findByText('서버에 연결하지 못했어요')).toBeTruthy()

  auth.resetPasswordForEmail.mockResolvedValueOnce(
    fail({ status: 400, code: 'email_address_not_authorized' }),
  )
  fireEvent.click(sendButton())
  await screen.findByText('이 주소로는 메일을 보낼 수 없어요')
  expect(screen.getByRole('link', { name: '로그인으로 이동' }).getAttribute('href')).toBe('/login')
})

it('R2: keeps the resend button locked for 60 seconds, then sends to the same address', async () => {
  vi.useFakeTimers()
  auth.resetPasswordForEmail.mockResolvedValue(ok)
  renderPage()
  fireEvent.change(emailInput(), { target: { value: 'student@example.com' } })
  fireEvent.click(sendButton())
  await flush()
  expect((resendButton() as HTMLButtonElement).disabled).toBe(true)
  expect(resendButton().textContent).toBe('메일 다시 보내기 (60초 뒤)')
  tick(60)
  expect((resendButton() as HTMLButtonElement).disabled).toBe(false)

  fireEvent.click(resendButton())
  await flush()
  expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(2)
  expect(auth.resetPasswordForEmail).toHaveBeenLastCalledWith('student@example.com', {
    redirectTo: `${window.location.origin}/reset-password`,
  })
  expect(screen.getByText('메일을 다시 보냈어요.')).toBeTruthy()
  expect((resendButton() as HTMLButtonElement).disabled).toBe(true)
})

it('R2: a resend that hits the rate limit says so and stays locked', async () => {
  vi.useFakeTimers()
  auth.resetPasswordForEmail
    .mockResolvedValueOnce(ok)
    .mockResolvedValueOnce(fail({ status: 429, code: 'over_email_send_rate_limit' }))
  renderPage()
  fireEvent.change(emailInput(), { target: { value: 'student@example.com' } })
  fireEvent.click(sendButton())
  await flush()
  tick(60)
  fireEvent.click(resendButton())
  await flush()
  expect(screen.getByText('메일 발송이 몰렸어요. 잠시 후 다시 시도해 주세요.')).toBeTruthy()
  expect((resendButton() as HTMLButtonElement).disabled).toBe(true)
})

it('R2: can go back to change the address', async () => {
  auth.resetPasswordForEmail.mockResolvedValue(ok)
  renderPage()
  fireEvent.change(emailInput(), { target: { value: 'student@example.com' } })
  fireEvent.click(sendButton())
  await screen.findByRole('heading', { name: '메일을 확인해 주세요' })
  fireEvent.click(screen.getByRole('button', { name: '이메일 주소 바꾸기' }))
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('비밀번호 재설정')
  expect((emailInput() as HTMLInputElement).value).toBe('student@example.com')
})

// R4: 링크를 쓸 수 없는 경우

it.each([
  ['/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'],
  ['/reset-password?error=access_denied&error_code=otp_expired'],
])('R4: an error in the address (%s) shows the expired screen without asking Supabase', (url) => {
  renderPage(url)
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('링크가 만료됐거나 이미 사용했어요')
  expect(screen.getByText('재설정 링크는 한 번만, 한 시간 안에 쓸 수 있어요. 새 링크를 받아 주세요.')).toBeTruthy()
  expect(auth.getSession).not.toHaveBeenCalled()
})

it('R4: "새 링크 받기" goes back to the request form', () => {
  renderPage('/reset-password#error=access_denied&error_code=otp_expired')
  fireEvent.click(screen.getByRole('button', { name: '새 링크 받기' }))
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('비밀번호 재설정')
  expect(emailInput()).toBeTruthy()
})

it('R4: a link that Supabase could not use (token still in the address) is expired, even with an old session', async () => {
  // 메일 보안 프로그램이 링크를 먼저 열어 토큰이 이미 쓰인 경우. 실패하면 supabase-js는 주소의 토큰을 지우지 않는다.
  window.location.hash = '#access_token=abc&type=recovery'
  auth.getSession.mockResolvedValue(sessionOf())
  renderPage(RECOVERY_URL)
  expect(await screen.findByRole('heading', { name: '링크가 만료됐거나 이미 사용했어요' })).toBeTruthy()
})

it('R4: a recovery link with no session is expired', async () => {
  auth.getSession.mockResolvedValue(noSession)
  renderPage(RECOVERY_URL)
  expect(await screen.findByRole('heading', { name: '링크가 만료됐거나 이미 사용했어요' })).toBeTruthy()
})

it('R4: a failing getSession is also expired', async () => {
  auth.getSession.mockRejectedValue(new Error('boom'))
  renderPage(RECOVERY_URL)
  expect(await screen.findByRole('heading', { name: '링크가 만료됐거나 이미 사용했어요' })).toBeTruthy()
})

// R3: 새 비밀번호

it('R3: checks the link first, then shows the new password form', async () => {
  let resolve: (value: unknown) => void = () => undefined
  auth.getSession.mockReturnValue(new Promise((r) => (resolve = r)))
  renderPage(RECOVERY_URL)
  expect(screen.getByText('링크를 확인하는 중…')).toBeTruthy()
  expect(screen.queryByLabelText('새 비밀번호')).toBeNull()
  await act(async () => {
    resolve(sessionOf())
    await Promise.resolve()
  })
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('새 비밀번호 설정')
  expect(screen.getByRole('list', { name: '비밀번호 규칙' })).toBeTruthy()
})

it('R3: the "same as your email" rule uses the account address from the session', async () => {
  await openFromRecoveryLink()
  fireEvent.change(newPasswordInput(), { target: { value: 'Student@Example.com' } })
  expect(screen.getByRole('list', { name: '비밀번호 규칙' }).textContent).toContain(
    '이메일 주소와 다름 (미충족)',
  )
})

it('R3: asks for both fields without saving when empty', async () => {
  await openFromRecoveryLink()
  fireEvent.click(changeButton())
  expect(screen.getByText('비밀번호를 입력해 주세요')).toBeTruthy()
  expect(screen.getByText('비밀번호를 한 번 더 입력해 주세요')).toBeTruthy()
  expect(auth.updateUser).not.toHaveBeenCalled()
})

it.each([
  ['abc1234', 'abc1234', '8자 이상이어야 해요'],
  ['abcdefgh', 'abcdefgh', '영문과 숫자를 함께 써 주세요'],
  ['abc12345', 'abc12346', '비밀번호가 서로 달라요'],
])('R3: rejects %s / %s with "%s" without saving', async (password, confirm, message) => {
  await openFromRecoveryLink()
  submitNewPassword(password, confirm)
  expect(screen.getByRole('alert').textContent).toBe(message)
  expect(auth.updateUser).not.toHaveBeenCalled()
})

it('R5: saves the new password, ends the recovery session and offers the login page', async () => {
  auth.updateUser.mockResolvedValue(ok)
  await openFromRecoveryLink()
  submitNewPassword('abc12345')
  await screen.findByRole('heading', { name: '비밀번호를 바꿨어요' })
  expect(auth.updateUser).toHaveBeenCalledWith({ password: 'abc12345' })
  expect(signOut).toHaveBeenCalledTimes(1)
  expect(screen.getByText('새 비밀번호로 로그인해 주세요.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '로그인하러 가기' }))
  expect(await screen.findByText('login page')).toBeTruthy()
})

it('R5: a failed sign-out does not turn a saved password into an error', async () => {
  auth.updateUser.mockResolvedValue(ok)
  signOut.mockRejectedValue(new Error('offline'))
  await openFromRecoveryLink()
  submitNewPassword()
  expect(await screen.findByRole('heading', { name: '비밀번호를 바꿨어요' })).toBeTruthy()
})

it('R3: does not sign out when the password could not be saved', async () => {
  auth.updateUser.mockResolvedValue(fail({ status: 500 }))
  await openFromRecoveryLink()
  submitNewPassword()
  await screen.findByText('비밀번호를 바꾸지 못했어요')
  expect(signOut).not.toHaveBeenCalled()
})

it('R3: locks the fields and the button while saving', async () => {
  auth.updateUser.mockReturnValue(new Promise(() => undefined))
  await openFromRecoveryLink()
  submitNewPassword()
  const busy = await screen.findByRole('button', { name: '바꾸는 중…' })
  expect((busy as HTMLButtonElement).disabled).toBe(true)
  expect((newPasswordInput() as HTMLInputElement).disabled).toBe(true)
})

it('R3: same_password and weak_password from the server go on the password field', async () => {
  await openFromRecoveryLink()
  auth.updateUser.mockResolvedValueOnce(fail({ status: 422, code: 'same_password' }))
  submitNewPassword()
  expect(await screen.findByText('이전과 다른 비밀번호를 써 주세요')).toBeTruthy()
  expect(newPasswordInput().getAttribute('aria-invalid')).toBe('true')

  auth.updateUser.mockResolvedValueOnce(fail({ status: 422, code: 'weak_password' }))
  fireEvent.click(changeButton())
  expect(await screen.findByText(/더 안전한 비밀번호를 써 주세요/)).toBeTruthy()
})

it.each([
  [{ status: 401 }],
  [{ code: 'session_not_found', status: 403 }],
  [{ name: 'AuthSessionMissingError', status: 400 }],
])('R4: saving with the recovery session gone (%j) shows the expired screen', async (error) => {
  auth.updateUser.mockResolvedValue(fail(error))
  await openFromRecoveryLink()
  submitNewPassword()
  expect(await screen.findByRole('heading', { name: '링크가 만료됐거나 이미 사용했어요' })).toBeTruthy()
})

it('R3: any other save error is a retryable failure, a thrown one too', async () => {
  await openFromRecoveryLink()
  auth.updateUser.mockResolvedValueOnce(fail({ status: 500 }))
  submitNewPassword()
  expect(await screen.findByText('비밀번호를 바꾸지 못했어요')).toBeTruthy()
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('새 비밀번호 설정')

  auth.updateUser.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(changeButton())
  await flush()
  expect(screen.getByText('비밀번호를 바꾸지 못했어요')).toBeTruthy()
})
