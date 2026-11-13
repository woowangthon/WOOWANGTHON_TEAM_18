import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import LoginPage from './LoginPage.tsx'

// 실제 Supabase를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  resend: vi.fn(),
}))
vi.mock('../lib/supabase.ts', () => ({ supabase: { auth } }))

const ok = { data: {}, error: null }
const fail = (error: { code?: string; status?: number }) => ({
  data: null,
  error: { message: 'x', ...error },
})

beforeEach(() => {
  auth.signInWithPassword.mockReset()
  auth.resend.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

// 성공하면 /dashboard로 가므로 그곳을 식별할 가짜 페이지를 둔다.
const renderPage = (state?: unknown) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state }]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<p>dashboard page</p>} />
        <Route path="/profile" element={<p>profile page</p>} />
        <Route path="//evil.example" element={<p>evil page</p>} />
      </Routes>
    </MemoryRouter>,
  )

const emailInput = () => screen.getByRole('textbox', { name: '이메일' })
const passwordInput = () => screen.getByLabelText('비밀번호')
const loginButton = () => screen.getByRole('button', { name: '로그인' })

const fillAndSubmit = (email: string, password: string) => {
  fireEvent.change(emailInput(), { target: { value: email } })
  fireEvent.change(passwordInput(), { target: { value: password } })
  fireEvent.click(loginButton())
}

it('shows the title, both fields and the two links', () => {
  renderPage()
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('로그인')
  expect(emailInput().getAttribute('type')).toBe('email')
  expect(passwordInput().getAttribute('type')).toBe('password')
  expect(
    screen.getByRole('link', { name: '비밀번호를 잊으셨나요?' }).getAttribute('href'),
  ).toBe('/reset-password')
  expect(screen.getByRole('link', { name: '회원가입' }).getAttribute('href')).toBe('/signup')
})

it('rejects a malformed email without calling Supabase', () => {
  renderPage()
  fillAndSubmit('abc', 'secret')
  expect(
    screen.getByText('올바른 이메일 형식이 아니에요. 예: name@example.com'),
  ).toBeTruthy()
  expect(emailInput().getAttribute('aria-invalid')).toBe('true')
  expect(auth.signInWithPassword).not.toHaveBeenCalled()
})

it('asks for both fields when they are empty without calling Supabase', () => {
  renderPage()
  fireEvent.click(loginButton())
  expect(screen.getByText('이메일을 입력해 주세요')).toBeTruthy()
  expect(screen.getByText('비밀번호를 입력해 주세요')).toBeTruthy()
  expect(passwordInput().getAttribute('aria-invalid')).toBe('true')
  expect(auth.signInWithPassword).not.toHaveBeenCalled()
})

it('trims the email (not the password) and goes to /dashboard on success', async () => {
  auth.signInWithPassword.mockResolvedValue(ok)
  renderPage()
  fillAndSubmit('  user@example.com  ', ' pw ')
  expect(await screen.findByText('dashboard page')).toBeTruthy()
  expect(auth.signInWithPassword).toHaveBeenCalledWith({
    email: 'user@example.com',
    password: ' pw ',
  })
})

it('tells wrong credentials apart by code and keeps what was typed', async () => {
  auth.signInWithPassword.mockResolvedValue(
    fail({ code: 'invalid_credentials', status: 400 }),
  )
  renderPage()
  fillAndSubmit('user@example.com', 'wrong')
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('이메일 또는 비밀번호가 올바르지 않아요')
  expect((emailInput() as HTMLInputElement).value).toBe('user@example.com')
  expect((passwordInput() as HTMLInputElement).value).toBe('wrong')
})

it('offers to resend the verification mail when the email is not confirmed', async () => {
  auth.signInWithPassword.mockResolvedValue(
    fail({ code: 'email_not_confirmed', status: 400 }),
  )
  auth.resend.mockResolvedValue(ok)
  renderPage()
  fillAndSubmit('new@example.com', 'pw')
  // 제출 중 안내도 role=status라서 역할이 아니라 제목 글자로 기다린다.
  expect(await screen.findByText('이메일 인증이 아직 안 됐어요')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: '인증 메일 다시 보내기' }))
  expect(await screen.findByText('인증 메일을 다시 보냈어요.')).toBeTruthy()
  expect(auth.resend).toHaveBeenCalledWith({
    type: 'signup',
    email: 'new@example.com',
    options: { emailRedirectTo: `${window.location.origin}/profile` },
  })
})

it('resends to the address that was found unverified, even if the field is edited afterwards', async () => {
  auth.signInWithPassword.mockResolvedValue(
    fail({ code: 'email_not_confirmed', status: 400 }),
  )
  auth.resend.mockResolvedValue(ok)
  renderPage()
  fillAndSubmit('new@example.com', 'pw')
  const resendButton = await screen.findByRole('button', { name: '인증 메일 다시 보내기' })
  // 안내가 떠 있는 동안 입력칸을 고쳐도, 확인된 적 없는 주소로 보내면 안 된다.
  fireEvent.change(emailInput(), { target: { value: 'typo@example.com' } })
  fireEvent.click(resendButton)
  await screen.findByText('인증 메일을 다시 보냈어요.')
  expect(auth.resend).toHaveBeenCalledWith({
    type: 'signup',
    email: 'new@example.com',
    options: { emailRedirectTo: `${window.location.origin}/profile` },
  })
})

it('asks the user to wait when resending hits the mail rate limit', async () => {
  auth.signInWithPassword.mockResolvedValue(
    fail({ code: 'email_not_confirmed', status: 400 }),
  )
  auth.resend.mockResolvedValue(fail({ code: 'over_email_send_rate_limit', status: 429 }))
  renderPage()
  fillAndSubmit('new@example.com', 'pw')
  fireEvent.click(await screen.findByRole('button', { name: '인증 메일 다시 보내기' }))
  expect(
    await screen.findByText('잠시 후 다시 시도해 주세요. 메일은 시간당 몇 통만 보낼 수 있어요.'),
  ).toBeTruthy()
})

it('locks the login button for a minute after too many attempts (429)', async () => {
  // 가짜 시계가 실제 시간과 함께 흘러야 findBy의 폴링이 멈추지 않는다.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  auth.signInWithPassword.mockResolvedValue(
    fail({ code: 'over_request_rate_limit', status: 429 }),
  )
  renderPage()
  fillAndSubmit('user@example.com', 'pw')
  expect(await screen.findByText('시도가 많아서 잠시 쉬어요')).toBeTruthy()
  expect((loginButton() as HTMLButtonElement).disabled).toBe(true)

  await act(async () => {
    await vi.advanceTimersByTimeAsync(59_000)
  })
  expect((loginButton() as HTMLButtonElement).disabled).toBe(true)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000)
  })
  expect((loginButton() as HTMLButtonElement).disabled).toBe(false)
  // 잠금이 풀렸는데 "1분 뒤에 다시" 안내가 남아 있으면 헷갈린다.
  expect(screen.queryByText('시도가 많아서 잠시 쉬어요')).toBeNull()
})

it.each([
  ['an unknown error code', () => auth.signInWithPassword.mockResolvedValue(fail({ code: 'x', status: 500 }))],
  ['a rejected request', () => auth.signInWithPassword.mockRejectedValue(new TypeError('Failed to fetch'))],
])('shows a plain connection message for %s, without internal terms', async (_name, arrange) => {
  arrange()
  renderPage()
  fillAndSubmit('user@example.com', 'pw')
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('로그인 서버에 연결하지 못했어요')
  expect(document.body.textContent).not.toMatch(/Supabase|429|토큰|token/i)
})

it('locks the form while submitting and releases it afterwards', async () => {
  let finish: (value: unknown) => void = () => undefined
  auth.signInWithPassword.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  renderPage()
  fillAndSubmit('user@example.com', 'pw')

  const busy = await screen.findByRole('button', { name: '로그인하는 중…' })
  expect((busy as HTMLButtonElement).disabled).toBe(true)
  expect(busy.getAttribute('aria-busy')).toBe('true')
  expect((emailInput() as HTMLInputElement).disabled).toBe(true)
  expect(screen.queryByText('입력은 잠겨 있어요. 보통 1~2초 걸려요.')).toBeNull()

  finish(fail({ code: 'invalid_credentials', status: 400 }))
  await waitFor(() => {
    expect((loginButton() as HTMLButtonElement).disabled).toBe(false)
  })
  expect((emailInput() as HTMLInputElement).disabled).toBe(false)
})

it('shows and hides the password with the toggle button', () => {
  renderPage()
  fireEvent.click(screen.getByRole('button', { name: '비밀번호 보기' }))
  expect(passwordInput().getAttribute('type')).toBe('text')
  fireEvent.click(screen.getByRole('button', { name: '비밀번호 숨기기' }))
  expect(passwordInput().getAttribute('type')).toBe('password')
})

it('goes back to the page the visitor came from after logging in', async () => {
  auth.signInWithPassword.mockResolvedValue(ok)
  renderPage({ from: '/profile' })
  fillAndSubmit('me@example.com', 'secret')
  expect(await screen.findByText('profile page')).toBeTruthy()
})

it('ignores a "from" that is not an internal path', async () => {
  auth.signInWithPassword.mockResolvedValue(ok)
  renderPage({ from: '//evil.example' })
  fillAndSubmit('me@example.com', 'secret')
  expect(await screen.findByText('dashboard page')).toBeTruthy()
})

it('shows the session-expired notice, heading and button when the session ended', () => {
  renderPage({ from: '/profile', expired: true })
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('다시 로그인해 주세요')
  expect(screen.getByText('로그인 시간이 지났어요')).toBeTruthy()
  expect(
    screen.getByText(/다시 로그인하면 하던 곳으로\s*돌아가요/),
  ).toBeTruthy()
  expect(screen.getByRole('button', { name: '로그인하고 돌아가기' })).toBeTruthy()
})

it('shows no expired notice on a plain visit', () => {
  renderPage()
  expect(screen.queryByText('로그인 시간이 지났어요')).toBeNull()
})
