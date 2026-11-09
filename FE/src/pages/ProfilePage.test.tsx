import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import ProfilePage from './ProfilePage.tsx'

// 실제 Supabase를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const auth = vi.hoisted(() => ({
  getUserIdentities: vi.fn(),
  linkIdentity: vi.fn(),
}))
vi.mock('../lib/supabase.ts', () => ({ supabase: { auth } }))

const identities = (list: unknown[]) => ({ data: { identities: list }, error: null })
const emailOnly = identities([{ provider: 'email' }])
const githubLinked = identities([
  { provider: 'email' },
  { provider: 'github', identity_data: { user_name: 'student-gh' } },
])

beforeEach(() => {
  auth.getUserIdentities.mockReset()
  auth.linkIdentity.mockReset()
})

const renderPage = (url = '/profile') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ProfilePage />
    </MemoryRouter>,
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

it('G4: still says linked when the identity has no user name', async () => {
  auth.getUserIdentities.mockResolvedValue(identities([{ provider: 'github' }]))
  renderPage()
  expect(await screen.findByText('GitHub 계정을 연동했어요')).toBeTruthy()
  expect(screen.getByText(/GitHub 계정이 연결됐어요/)).toBeTruthy()
})

it('G2: the button calls linkIdentity for GitHub and returns to /profile', async () => {
  auth.getUserIdentities.mockResolvedValue(emailOnly)
  auth.linkIdentity.mockReturnValue(new Promise(() => undefined))
  renderPage()
  await screen.findByText('GitHub 계정 연동')
  fireEvent.click(linkButton())
  expect(auth.linkIdentity).toHaveBeenCalledWith({
    provider: 'github',
    options: { redirectTo: `${window.location.origin}/profile` },
  })
  const busy = await screen.findByRole('button', { name: 'GitHub로 이동하는 중…' })
  expect((busy as HTMLButtonElement).disabled).toBe(true)
  expect(busy.getAttribute('aria-busy')).toBe('true')
  expect(
    screen.getByText('GitHub 화면으로 이동해요. 승인하면 이 화면으로 자동으로 돌아와요.'),
  ).toBeTruthy()
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
