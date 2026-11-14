import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/auth-context.ts'
import { WithQuery } from '../test-utils.tsx'
import ProfilePage from './ProfilePage.tsx'

// 실제 Supabase를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const auth = vi.hoisted(() => ({
  getUserIdentities: vi.fn(),
  linkIdentity: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
}))
vi.mock('../lib/supabase.ts', () => ({ supabase: { auth } }))
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  apiFetch: api.apiFetch,
}))

const identities = (list: unknown[]) => ({ data: { identities: list }, error: null })
const emailOnly = identities([{ provider: 'email' }])
const githubLinked = identities([
  { provider: 'email' },
  { provider: 'github', identity_data: { user_name: 'student-gh' } },
])

beforeEach(() => {
  auth.getUserIdentities.mockReset()
  auth.linkIdentity.mockReset()
  auth.signInWithPassword.mockReset()
  auth.updateUser.mockReset()
  api.apiFetch.mockReset().mockResolvedValue({ deploys: [] })
})

const sessionOf = (appMetadata: Record<string, unknown> = {}, email = 'me@example.com') =>
  ({
    access_token: 'tok',
    user: {
      email,
      app_metadata: appMetadata,
      created_at: '2026-11-01T03:00:00.000Z',
      last_sign_in_at: '2026-11-13T05:30:00.000Z',
    },
  }) as never
const renderPage = (url = '/profile', appMetadata: Record<string, unknown> = {}, email = 'me@example.com') =>
  render(
    <WithQuery>
      <AuthContext.Provider
        value={{
          state: { status: 'signedIn', session: sessionOf(appMetadata, email) },
          signOut: () => Promise.resolve(),
        }}
      >
        <MemoryRouter initialEntries={[url]}>
          <ProfilePage />
        </MemoryRouter>
      </AuthContext.Provider>
    </WithQuery>,
  )
const linkButton = () => screen.getByRole('button', { name: 'GitHub로 연동하기' })

it('shows the checking state until the identities arrive', async () => {
  auth.getUserIdentities.mockResolvedValue(emailOnly)
  renderPage()
  expect(screen.getByText('연동 결과를 확인하는 중…')).toBeTruthy()
  expect(await screen.findByText('GitHub 계정 연동')).toBeTruthy()
})

it('G1: asks to link with the three reassurances when no GitHub identity exists', async () => {
  auth.getUserIdentities.mockResolvedValue(emailOnly)
  renderPage()
  expect(await screen.findByText('GitHub 계정 연동')).toBeTruthy()
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('프로필')
  expect(screen.getByText('내가 올린 레포가 내 계정 것인지 확인하는 데만 써요.')).toBeTruthy()
  expect(screen.getByText('읽기 권한만 요청해요. 코드를 바꾸지 않아요.')).toBeTruthy()
  expect(
    screen.getByText('GitHub로 로그인하는 건 아니에요. 로그인은 지금처럼 이메일로 해요.'),
  ).toBeTruthy()
  expect(linkButton()).toBeTruthy()
  expect(screen.queryByText('GitHub 연동에 실패했어요')).toBeNull()
})

it('G4: shows the linked handle and a link to the new deploy page', async () => {
  auth.getUserIdentities.mockResolvedValue(githubLinked)
  renderPage()
  expect(await screen.findByText('GitHub 계정을 연동했어요')).toBeTruthy()
  expect(screen.getByText(/@student-gh 계정이 연결됐어요/)).toBeTruthy()
  expect(
    screen.getByRole('link', { name: '새 배포 요청하기' }).getAttribute('href'),
  ).toBe('/deploy/new')
  expect(screen.queryByRole('button', { name: 'GitHub로 연동하기' })).toBeNull()
})

it('G4: hides the new deploy link for an admin (monitoring account) but still says linked', async () => {
  auth.getUserIdentities.mockResolvedValue(githubLinked)
  renderPage('/profile', { role: 'admin' })
  expect(await screen.findByText('GitHub 계정을 연동했어요')).toBeTruthy()
  expect(screen.queryByRole('link', { name: '새 배포 요청하기' })).toBeNull()
})

it('G4: still says linked when the identity has no user name', async () => {
  auth.getUserIdentities.mockResolvedValue(identities([{ provider: 'github' }]))
  renderPage()
  expect(await screen.findByText('GitHub 계정을 연동했어요')).toBeTruthy()
  expect(screen.getByText(/GitHub 계정이 연결됐어요/)).toBeTruthy()
})

it('G2: the button calls linkIdentity for GitHub, asks GitHub to show the account picker and returns to /profile', async () => {
  auth.getUserIdentities.mockResolvedValue(emailOnly)
  auth.linkIdentity.mockReturnValue(new Promise(() => undefined))
  renderPage()
  await screen.findByText('GitHub 계정 연동')
  fireEvent.click(linkButton())
  expect(auth.linkIdentity).toHaveBeenCalledWith({
    provider: 'github',
    options: {
      redirectTo: `${window.location.origin}/profile`,
      queryParams: { prompt: 'select_account' },
    },
  })
  const busy = await screen.findByRole('button', { name: 'GitHub로 이동하는 중…' })
  expect((busy as HTMLButtonElement).disabled).toBe(true)
  expect(busy.getAttribute('aria-busy')).toBe('true')
  expect(
    screen.getByText('GitHub 화면으로 이동해요. 승인하면 이 화면으로 자동으로 돌아와요.'),
  ).toBeTruthy()
})

it('G2: leaving for GitHub and coming back from the back/forward cache re-enables the button', async () => {
  auth.getUserIdentities.mockResolvedValue(emailOnly)
  auth.linkIdentity.mockReturnValue(new Promise(() => undefined))
  renderPage()
  await screen.findByText('GitHub 계정 연동')
  fireEvent.click(linkButton())
  await screen.findByRole('button', { name: 'GitHub로 이동하는 중…' })
  // 일반 이동으로 새로 불린 화면(persisted=false)은 상태가 새로 시작하므로 건드리지 않는다.
  act(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))
  })
  expect(screen.queryByRole('button', { name: 'GitHub로 연동하기' })).toBeNull()
  act(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  })
  const again = screen.getByRole('button', { name: 'GitHub로 연동하기' })
  expect((again as HTMLButtonElement).disabled).toBe(false)
})

it('G2: the error from the URL is hidden while a new attempt is redirecting', async () => {
  auth.getUserIdentities.mockResolvedValue(emailOnly)
  auth.linkIdentity.mockReturnValue(new Promise(() => undefined))
  renderPage('/profile?error=access_denied')
  expect(await screen.findByText('GitHub 연동에 실패했어요')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '다시 연동하기' }))
  await screen.findByRole('button', { name: 'GitHub로 이동하는 중…' })
  expect(screen.queryByText('GitHub 연동에 실패했어요')).toBeNull()
})

it('G3: shows a temporary error and re-enables the button when linkIdentity fails', async () => {
  auth.getUserIdentities.mockResolvedValue(emailOnly)
  auth.linkIdentity.mockResolvedValue({ data: null, error: { message: 'x', code: 'manual_linking_disabled' } })
  renderPage()
  await screen.findByText('GitHub 계정 연동')
  fireEvent.click(linkButton())
  expect(await screen.findByText('GitHub 연동에 실패했어요')).toBeTruthy()
  expect(screen.getByText('GitHub 또는 우리 쪽 문제예요. 잠시 후 다시 시도해 주세요.')).toBeTruthy()
  const retry = screen.getByRole('button', { name: '다시 연동하기' })
  expect((retry as HTMLButtonElement).disabled).toBe(false)
})

it('G3: a thrown linkIdentity is also a temporary error', async () => {
  auth.getUserIdentities.mockResolvedValue(emailOnly)
  auth.linkIdentity.mockRejectedValue(new Error('offline'))
  renderPage()
  await screen.findByText('GitHub 계정 연동')
  fireEvent.click(linkButton())
  expect(
    await screen.findByText('GitHub 또는 우리 쪽 문제예요. 잠시 후 다시 시도해 주세요.'),
  ).toBeTruthy()
})

it('G3: identity_already_exists from linkIdentity says the account is linked elsewhere', async () => {
  auth.getUserIdentities.mockResolvedValue(emailOnly)
  auth.linkIdentity.mockResolvedValue({ data: null, error: { message: 'x', code: 'identity_already_exists' } })
  renderPage()
  await screen.findByText('GitHub 계정 연동')
  fireEvent.click(linkButton())
  expect(await screen.findByText(/다른 WCP 계정에 연동돼 있어요/)).toBeTruthy()
})

it.each([
  ['?error=access_denied&error_description=The+user+denied+access', 'GitHub 화면에서 승인하지 않았어요. 다시 시도하면 돼요.'],
  ['#error=server_error&error_code=bad_oauth_callback&error_description=OAuth+Provider+returned+error%3A+access_denied', 'GitHub 화면에서 승인하지 않았어요. 다시 시도하면 돼요.'],
  ['#error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked', '이 GitHub 계정은 다른 WCP 계정에 연동돼 있어요. 그 계정에서 연동을 풀거나 다른 GitHub 계정을 써 주세요.'],
  ['?error=server_error&error_code=unexpected_failure', 'GitHub 또는 우리 쪽 문제예요. 잠시 후 다시 시도해 주세요.'],
])('G3: the error that came back in the URL (%s) shows one cause', async (suffix, text) => {
  auth.getUserIdentities.mockResolvedValue(emailOnly)
  renderPage(`/profile${suffix}`)
  expect(await screen.findByText('GitHub 연동에 실패했어요')).toBeTruthy()
  expect(screen.getByText(text)).toBeTruthy()
  expect(screen.getAllByText(/WCP 계정에 연동돼|승인하지 않았어요|우리 쪽 문제예요/)).toHaveLength(1)
  expect(screen.getByRole('button', { name: '다시 연동하기' })).toBeTruthy()
})

it('shows linked, not an error, when the identity is there even with an error in the URL', async () => {
  auth.getUserIdentities.mockResolvedValue(githubLinked)
  renderPage('/profile?error=access_denied')
  expect(await screen.findByText('GitHub 계정을 연동했어요')).toBeTruthy()
  expect(screen.queryByText('GitHub 연동에 실패했어요')).toBeNull()
})

it('says the status could not be checked and retries on request', async () => {
  auth.getUserIdentities
    .mockResolvedValueOnce({ data: null, error: { message: 'x' } })
    .mockResolvedValueOnce(githubLinked)
  renderPage()
  expect(await screen.findByText('연동 상태를 확인하지 못했어요')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '다시 확인하기' }))
  expect(await screen.findByText('GitHub 계정을 연동했어요')).toBeTruthy()
  expect(auth.getUserIdentities).toHaveBeenCalledTimes(2)
})

it('treats a thrown getUserIdentities as a failed check, not as unlinked', async () => {
  auth.getUserIdentities.mockRejectedValue(new Error('offline'))
  renderPage()
  expect(await screen.findByText('연동 상태를 확인하지 못했어요')).toBeTruthy()
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'GitHub로 연동하기' })).toBeNull()
  })
})

it('shows the account info: email, join date and last sign-in', async () => {
  auth.getUserIdentities.mockResolvedValue(emailOnly)
  renderPage()
  const section = screen.getByRole('region', { name: '계정 정보' })
  expect(within(section).getByText('me@example.com')).toBeTruthy()
  expect(within(section).getByText(new Date('2026-11-01T03:00:00.000Z').toLocaleString('ko-KR'))).toBeTruthy()
  expect(within(section).getByText(new Date('2026-11-13T05:30:00.000Z').toLocaleString('ko-KR'))).toBeTruthy()
  await screen.findByText('GitHub 계정 연동')
})

it('has a section menu that jumps to the five sections', async () => {
  auth.getUserIdentities.mockResolvedValue(emailOnly)
  renderPage()
  const menu = screen.getByRole('navigation', { name: '프로필 구역' })
  expect(within(menu).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
    '#account',
    '#password',
    '#github',
    '#discord',
    '#deploys',
  ])
  await screen.findByText('GitHub 계정 연동')
})

it('summarises my deploys by project: count and running, with a link to the list', async () => {
  auth.getUserIdentities.mockResolvedValue(emailOnly)
  const run = (id: string, slug: string, status: string, createdAt: string) => ({ id, slug, status, createdAt, repo: `me/${slug}`, commit: 'x', stage: null, url: null })
  api.apiFetch.mockResolvedValue({
    deploys: [
      run('3', 'a', 'succeeded', '2026-11-13T00:00:00Z'),
      run('2', 'a', 'failed', '2026-11-12T00:00:00Z'),
      run('1', 'b', 'failed', '2026-11-11T00:00:00Z'),
    ],
  })
  renderPage()
  const section = screen.getByRole('region', { name: '내 배포 요약' })
  await waitFor(() => {
    expect(section.textContent).toContain('프로젝트 2개 · 실행 중 1개')
  })
  expect(within(section).getByRole('link', { name: '내 배포 보기' }).getAttribute('href')).toBe('/deploys')
})

it('says the summary failed to load and retries', async () => {
  auth.getUserIdentities.mockResolvedValue(emailOnly)
  // Discord 웹후크 읽기도 같은 apiFetch다. 처음 실패하는 것은 배포 목록(경로)에만 건다.
  let deployReads = 0
  api.apiFetch.mockImplementation((path: string) => {
    if (path === '/api/profile/discord-webhook') return Promise.resolve({ set: false, hint: null })
    deployReads += 1
    return deployReads === 1 ? Promise.reject(new Error('down')) : Promise.resolve({ deploys: [] })
  })
  renderPage()
  const section = screen.getByRole('region', { name: '내 배포 요약' })
  fireEvent.click(await within(section).findByRole('button', { name: '다시 시도' }))
  await waitFor(() => {
    expect(section.textContent).toContain('프로젝트 0개 · 실행 중 0개')
  })
})

describe('password change', () => {
  const field = (name: string) => screen.getByLabelText<HTMLInputElement>(name)
  const type = (name: string, value: string) => {
    fireEvent.change(field(name), { target: { value } })
  }
  const fill = (current = 'oldpass12', next = 'newpass123', confirm = next) => {
    type('현재 비밀번호', current)
    type('새 비밀번호', next)
    type('새 비밀번호 확인', confirm)
  }
  const submit = () => {
    fireEvent.click(screen.getByRole('button', { name: '비밀번호 바꾸기' }))
  }
  beforeEach(() => {
    auth.getUserIdentities.mockResolvedValue(emailOnly)
    auth.signInWithPassword.mockResolvedValue({ error: null })
    auth.updateUser.mockResolvedValue({ error: null })
  })

  it('re-checks the current password, then updates it, and clears the form', async () => {
    renderPage()
    fill()
    submit()
    expect(await screen.findByText('비밀번호를 바꿨어요')).toBeTruthy()
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'me@example.com', password: 'oldpass12' })
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'newpass123' })
    expect(auth.signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(auth.updateUser.mock.invocationCallOrder[0] ?? 0)
    expect(field('현재 비밀번호').value).toBe('')
    expect(field('새 비밀번호').value).toBe('')
  })

  it('applies the signup rules before calling Supabase', () => {
    renderPage()
    fill('oldpass12', 'short', 'short')
    submit()
    expect(screen.getByText('8자 이상이어야 해요')).toBeTruthy()
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('asks for every field and a matching confirmation', () => {
    renderPage()
    fill('', 'newpass123', 'different123')
    submit()
    expect(screen.getByText('현재 비밀번호를 입력해 주세요')).toBeTruthy()
    expect(screen.getByText('비밀번호가 서로 달라요')).toBeTruthy()
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('refuses a new password equal to the current one', () => {
    renderPage()
    fill('samepass12', 'samepass12')
    submit()
    expect(screen.getByText('현재 비밀번호와 다른 비밀번호를 써 주세요')).toBeTruthy()
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('shows a wrong current password on its field and does not update', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { code: 'invalid_credentials', status: 400 } })
    renderPage()
    fill()
    submit()
    expect(await screen.findByText('현재 비밀번호가 맞지 않아요')).toBeTruthy()
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('shows the weak-password error from the server on the new password field', async () => {
    auth.updateUser.mockResolvedValue({ error: { code: 'weak_password', status: 422 } })
    renderPage()
    fill()
    submit()
    expect(await screen.findByText(/더 안전한 비밀번호를 써 주세요/)).toBeTruthy()
    expect(screen.queryByText('비밀번호를 바꿨어요')).toBeNull()
  })

  it('says the password was not changed when the update fails for another reason', async () => {
    auth.updateUser.mockResolvedValue({ error: { code: 'unexpected_failure', status: 500 } })
    renderPage()
    fill()
    submit()
    expect(await screen.findByText('비밀번호를 바꾸지 못했어요')).toBeTruthy()
    expect(screen.queryByText('비밀번호를 바꿨어요')).toBeNull()
  })

  it('says to wait when the re-check is rate limited, and treats a thrown error as a failure', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { code: 'over_request_rate_limit', status: 429 } })
    renderPage()
    fill()
    submit()
    expect(await screen.findByText('시도가 많아서 잠시 쉬어요')).toBeTruthy()
    auth.signInWithPassword.mockRejectedValueOnce(new Error('offline'))
    submit()
    expect(await screen.findByText('비밀번호를 바꾸지 못했어요')).toBeTruthy()
  })

  it.each(['test@example.com', 'admin@example.com', 'Test@Example.com'])('locks the demo account %s', (email) => {
    renderPage('/profile', {}, email)
    expect(screen.getByText('시연 계정은 비밀번호를 바꿀 수 없어요')).toBeTruthy()
    for (const name of ['현재 비밀번호', '새 비밀번호', '새 비밀번호 확인']) {
      expect(field(name).disabled).toBe(true)
    }
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '비밀번호 바꾸기' }).disabled).toBe(true)
  })

  it('does not lock an ordinary account', () => {
    renderPage()
    expect(screen.queryByText('시연 계정은 비밀번호를 바꿀 수 없어요')).toBeNull()
    expect(field('현재 비밀번호').disabled).toBe(false)
  })
})

it('puts a picture next to each section title, hidden from screen readers', async () => {
  auth.getUserIdentities.mockResolvedValue(emailOnly)
  renderPage()
  await screen.findByText('GitHub 계정 연동')
  for (const name of ['계정 정보', '비밀번호 변경', 'GitHub 연동', 'Discord 알림', '내 배포 요약']) {
    const heading = screen.getByRole('heading', { name })
    expect(heading.querySelector('[aria-hidden="true"] svg')).toBeTruthy()
  }
})
