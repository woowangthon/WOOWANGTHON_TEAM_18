import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SignupPage from './SignupPage.tsx'

// 실제 Supabase를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  resend: vi.fn(),
}))
vi.mock('../lib/supabase.ts', () => ({ supabase: { auth } }))

const ok = { data: {}, error: null }
const fail = (error: { code?: string; status?: number }) => ({
  data: null,
  error: { message: 'x', ...error },
})

beforeEach(() => {
  auth.signUp.mockReset()
  auth.resend.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

const renderPage = () =>
  render(
    <MemoryRouter>
      <SignupPage />
    </MemoryRouter>,
  )

const emailInput = () => screen.getByRole('textbox', { name: '이메일' })
const passwordInput = () => screen.getByLabelText('비밀번호')
const confirmInput = () => screen.getByLabelText('비밀번호 확인')
const signupButton = () => screen.getByRole('button', { name: '가입하기' })

const fill = (email: string, password: string, confirm = password) => {
  fireEvent.change(emailInput(), { target: { value: email } })
  fireEvent.change(passwordInput(), { target: { value: password } })
  fireEvent.change(confirmInput(), { target: { value: confirm } })
}
const fillAndSubmit = (email = 'student@example.com', password = 'abc12345') => {
  fill(email, password)
  fireEvent.click(signupButton())
}
const tick = (seconds: number) => {
  for (let i = 0; i < seconds; i += 1) {
    act(() => {
      vi.advanceTimersByTime(1000)
    })
  }
}
const resendButton = () => screen.getByRole('button', { name: /인증 메일 다시 보내기/ })

it('shows the title, the three fields, the rules and the login link', () => {
  renderPage()
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('회원가입')
  expect(emailInput().getAttribute('type')).toBe('email')
  expect(passwordInput().getAttribute('type')).toBe('password')
  expect(confirmInput().getAttribute('type')).toBe('password')
  expect(screen.getByRole('link', { name: '로그인' }).getAttribute('href')).toBe('/login')
  const rules = screen.getByRole('list', { name: '비밀번호 규칙' })
  expect(rules.textContent).toContain('8자 이상 (미충족)')
  expect(rules.textContent).toContain('영문과 숫자를 함께 사용 (미충족)')
  expect(rules.textContent).toContain('이메일 주소와 다름 (미충족)')
})

it('marks each password rule as met while typing', () => {
  renderPage()
  fireEvent.change(emailInput(), { target: { value: 'student@example.com' } })
  fireEvent.change(passwordInput(), { target: { value: 'abcdefgh' } })
  let rules = screen.getByRole('list', { name: '비밀번호 규칙' }).textContent
  expect(rules).toContain('8자 이상 (충족)')
  expect(rules).toContain('영문과 숫자를 함께 사용 (미충족)')
  expect(rules).toContain('이메일 주소와 다름 (충족)')

  fireEvent.change(passwordInput(), { target: { value: 'abc12345' } })
  rules = screen.getByRole('list', { name: '비밀번호 규칙' }).textContent
  expect(rules).toContain('영문과 숫자를 함께 사용 (충족)')

  fireEvent.change(emailInput(), { target: { value: 'ABC12345' } })
  expect(screen.getByRole('list', { name: '비밀번호 규칙' }).textContent).toContain(
    '이메일 주소와 다름 (미충족)',
  )
})

it('toggles each password field by its own name', () => {
  renderPage()
  fireEvent.click(screen.getByRole('button', { name: '비밀번호 보기' }))
  expect(passwordInput().getAttribute('type')).toBe('text')
  expect(confirmInput().getAttribute('type')).toBe('password')
  fireEvent.click(screen.getByRole('button', { name: '비밀번호 확인 보기' }))
  expect(confirmInput().getAttribute('type')).toBe('text')
  expect(screen.getByRole('button', { name: '비밀번호 숨기기' })).toBeTruthy()
})

it('asks for every field without calling the server when all are empty', () => {
  renderPage()
  fireEvent.click(signupButton())
  expect(screen.getByText('이메일을 입력해 주세요')).toBeTruthy()
  expect(screen.getByText('비밀번호를 입력해 주세요')).toBeTruthy()
  expect(screen.getByText('비밀번호를 한 번 더 입력해 주세요')).toBeTruthy()
  expect(auth.signUp).not.toHaveBeenCalled()
})

it.each([
  ['student@example.com', 'abc1234', '8자 이상이어야 해요'],
  ['student@example.com', 'abcdefgh', '영문과 숫자를 함께 써 주세요'],
  ['abc12345@example.com', 'ABC12345@EXAMPLE.COM', '이메일 주소와 다른 비밀번호를 써 주세요'],
])('rejects %s / %s with the first unmet rule', (email, password, message) => {
  renderPage()
  fill(email, password)
  fireEvent.click(signupButton())
  expect(screen.getByRole('alert').textContent).toBe(message)
  expect(auth.signUp).not.toHaveBeenCalled()
})

it('rejects a malformed email and a mismatched confirmation without calling the server', () => {
  renderPage()
  fill('student', 'abc12345', 'abc12346')
  fireEvent.click(signupButton())
  expect(screen.getByText('올바른 이메일 형식이 아니에요. 예: name@example.com')).toBeTruthy()
  expect(screen.getByText('비밀번호가 서로 달라요')).toBeTruthy()
  expect(auth.signUp).not.toHaveBeenCalled()
})

it('signs up with the trimmed email and sends the link back to /profile', async () => {
  auth.signUp.mockResolvedValue(ok)
  renderPage()
  fillAndSubmit('  student@example.com  ')
  await screen.findByRole('heading', { name: '메일을 확인해 주세요' })
  expect(auth.signUp).toHaveBeenCalledWith({
    email: 'student@example.com',
    password: 'abc12345',
    options: { emailRedirectTo: `${window.location.origin}/profile` },
  })
  expect(screen.getByText('student@example.com')).toBeTruthy()
  expect(screen.getByText(/스팸함도 확인해 주세요/)).toBeTruthy()
})

it('locks the inputs and the button while the request is pending', async () => {
  auth.signUp.mockReturnValue(new Promise(() => undefined))
  renderPage()
  fillAndSubmit()
  const busy = await screen.findByRole('button', { name: '가입하는 중…' })
  expect((busy as HTMLButtonElement).disabled).toBe(true)
  expect((emailInput() as HTMLInputElement).disabled).toBe(true)
  expect((passwordInput() as HTMLInputElement).disabled).toBe(true)
})

it('shows the same mail screen with the "already registered" hint for every address', async () => {
  // 이미 가입된 주소여도 Supabase는 성공처럼 답한다. 화면이 계정 유무를 드러내지 않는다.
  auth.signUp.mockResolvedValue(ok)
  renderPage()
  fillAndSubmit()
  await screen.findByRole('heading', { name: '메일을 확인해 주세요' })
  expect(screen.getByText('메일이 안 오나요?')).toBeTruthy()
  expect(screen.getByText(/이미 가입한 주소라면 메일이 오지 않을 수 있어요/)).toBeTruthy()
  expect(screen.getByRole('link', { name: '로그인' }).getAttribute('href')).toBe('/login')
  expect(screen.getByRole('link', { name: '비밀번호를 다시 설정' }).getAttribute('href')).toBe(
    '/reset-password',
  )
})

it.each([
  [{ status: 429, code: 'over_email_send_rate_limit' }, '메일 발송이 몰렸어요', '잠시 후 다시 시도해 주세요.'],
  [{ status: 429 }, '메일 발송이 몰렸어요', '잠시 후 다시 시도해 주세요.'],
  [
    { status: 400, code: 'email_address_not_authorized' },
    '이 주소로는 메일을 보낼 수 없어요',
    '제공된 테스트 계정으로 로그인해 주세요.',
  ],
  [{ status: 500, code: 'unexpected_failure' }, '서버에 연결하지 못했어요', '잠시 후 다시 시도해 주세요.'],
])('a signUp error %j shows "%s" and stays on the form', async (error, title, body) => {
  auth.signUp.mockResolvedValue(fail(error))
  renderPage()
  fillAndSubmit()
  expect(await screen.findByText(title)).toBeTruthy()
  expect(screen.getByText(body)).toBeTruthy()
  expect(screen.queryByRole('heading', { name: '메일을 확인해 주세요' })).toBeNull()
  expect((emailInput() as HTMLInputElement).value).toBe('student@example.com')
})

it('a thrown signUp is the generic connection failure', async () => {
  auth.signUp.mockRejectedValue(new Error('offline'))
  renderPage()
  fillAndSubmit()
  expect(await screen.findByText('서버에 연결하지 못했어요')).toBeTruthy()
})

it('a team-outside address links back to login', async () => {
  auth.signUp.mockResolvedValue(fail({ status: 400, code: 'email_address_not_authorized' }))
  renderPage()
  fillAndSubmit()
  await screen.findByText('이 주소로는 메일을 보낼 수 없어요')
  expect(screen.getByRole('link', { name: '로그인으로 이동' }).getAttribute('href')).toBe('/login')
})

it('weak_password and email_address_invalid from the server go on their own field', async () => {
  auth.signUp.mockResolvedValueOnce(fail({ status: 422, code: 'weak_password' }))
  renderPage()
  fillAndSubmit()
  expect(await screen.findByText(/더 안전한 비밀번호를 써 주세요/)).toBeTruthy()
  expect(passwordInput().getAttribute('aria-invalid')).toBe('true')

  auth.signUp.mockResolvedValueOnce(fail({ status: 400, code: 'email_address_invalid' }))
  fireEvent.click(signupButton())
  expect(await screen.findByText('올바른 이메일 형식이 아니에요. 예: name@example.com')).toBeTruthy()
  expect(emailInput().getAttribute('aria-invalid')).toBe('true')
})

it('clears the old notice when submitting again', async () => {
  auth.signUp.mockResolvedValueOnce(fail({ status: 429 })).mockResolvedValueOnce(ok)
  renderPage()
  fillAndSubmit()
  await screen.findByText('메일 발송이 몰렸어요')
  fireEvent.click(signupButton())
  await screen.findByRole('heading', { name: '메일을 확인해 주세요' })
  expect(screen.queryByText('메일 발송이 몰렸어요')).toBeNull()
})

it('keeps the resend button locked for 60 seconds, then sends to the signup address', async () => {
  vi.useFakeTimers()
  auth.signUp.mockResolvedValue(ok)
  auth.resend.mockResolvedValue(ok)
  renderPage()
  fillAndSubmit()
  await act(async () => {
    await Promise.resolve()
  })
  expect(screen.getByRole('heading', { name: '메일을 확인해 주세요' })).toBeTruthy()
  expect((resendButton() as HTMLButtonElement).disabled).toBe(true)
  expect(resendButton().textContent).toBe('인증 메일 다시 보내기 (60초 뒤)')

  tick(59)
  expect((resendButton() as HTMLButtonElement).disabled).toBe(true)
  expect(resendButton().textContent).toBe('인증 메일 다시 보내기 (1초 뒤)')
  tick(1)
  expect((resendButton() as HTMLButtonElement).disabled).toBe(false)

  fireEvent.click(resendButton())
  await act(async () => {
    await Promise.resolve()
  })
  expect(auth.resend).toHaveBeenCalledWith({
    type: 'signup',
    email: 'student@example.com',
    options: { emailRedirectTo: `${window.location.origin}/profile` },
  })
  expect(screen.getByText('인증 메일을 다시 보냈어요.')).toBeTruthy()
  expect((resendButton() as HTMLButtonElement).disabled).toBe(true)
})

it.each([
  [fail({ status: 429, code: 'over_email_send_rate_limit' }), '메일 발송이 몰렸어요. 잠시 후 다시 시도해 주세요.', true],
  [fail({ status: 500 }), '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.', false],
])('a resend error shows its message (locked again: %s)', async (result, message, locked) => {
  vi.useFakeTimers()
  auth.signUp.mockResolvedValue(ok)
  auth.resend.mockResolvedValue(result)
  renderPage()
  fillAndSubmit()
  await act(async () => {
    await Promise.resolve()
  })
  tick(60)
  fireEvent.click(resendButton())
  await act(async () => {
    await Promise.resolve()
  })
  expect(screen.getByText(message)).toBeTruthy()
  expect((resendButton() as HTMLButtonElement).disabled).toBe(locked)
})

it('a thrown resend is the generic connection failure', async () => {
  vi.useFakeTimers()
  auth.signUp.mockResolvedValue(ok)
  auth.resend.mockRejectedValue(new Error('offline'))
  renderPage()
  fillAndSubmit()
  await act(async () => {
    await Promise.resolve()
  })
  tick(60)
  fireEvent.click(resendButton())
  await act(async () => {
    await Promise.resolve()
  })
  expect(screen.getByText('서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.')).toBeTruthy()
})

it('can go back to change the email address, keeping what was typed', async () => {
  auth.signUp.mockResolvedValue(ok)
  renderPage()
  fillAndSubmit()
  await screen.findByRole('heading', { name: '메일을 확인해 주세요' })
  fireEvent.click(screen.getByRole('button', { name: '이메일 주소 바꾸기' }))
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('회원가입')
  expect((emailInput() as HTMLInputElement).value).toBe('student@example.com')
  expect((passwordInput() as HTMLInputElement).value).toBe('abc12345')
})
