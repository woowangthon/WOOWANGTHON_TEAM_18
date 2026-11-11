import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App.tsx'

// 실제 Supabase를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
type Listener = (event: string, session: unknown) => void
const auth = vi.hoisted(() => ({
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  getUserIdentities: vi.fn(),
}))
vi.mock('./lib/supabase.ts', () => ({ supabase: { auth } }))
// 화면이 읽는 API는 여기서 보지 않는다(각 화면의 테스트가 본다). 답을 기다리는 채로 둔다.
vi.mock('./lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/api.ts')>()),
  apiFetch: () => new Promise(() => undefined),
}))

const sessionWith = (appMetadata: Record<string, unknown> = {}, userMetadata: Record<string, unknown> = {}) => ({
  access_token: 'tok',
  user: { email: 'me@example.com', app_metadata: appMetadata, user_metadata: userMetadata },
})
const session = sessionWith()
let emit: (event: string, session: unknown) => void

beforeEach(() => {
  auth.signInWithPassword.mockReset()
  auth.signOut.mockReset().mockResolvedValue({ error: null })
  auth.getUserIdentities.mockReset().mockResolvedValue({ data: { identities: [] }, error: null })
  auth.onAuthStateChange.mockReset().mockImplementation((listener: Listener) => {
    emit = (event, next) => {
      act(() => {
        listener(event, next)
      })
    }
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
})

const renderApp = (path: string, initial: 'in' | 'out' | 'restoring' = 'in', signedInAs: unknown = session) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
  if (initial !== 'restoring') emit('INITIAL_SESSION', initial === 'in' ? signedInAs : null)
}
const h1 = () => screen.getByRole('heading', { level: 1 }).textContent

// 화면을 채우는 이슈(#51~#57)는 각자 자기 페이지 파일을 고치므로, 여기서는 경로와 페이지의 연결만 본다.
const publicRoutes = [
  ['/login', '로그인'],
  ['/signup', '회원가입'],
  ['/reset-password', '비밀번호 재설정'],
] as const

const protectedRoutes = [
  ['/profile', '프로필'],
  ['/dashboard', '대시보드'],
  ['/deploy/new', '새 배포 요청'],
  ['/deploys', '내 배포'],
  ['/deploys/0b6f0c1e-4a52-4d8e-9a1b-3f7d2c5e8a90', '배포 진행 상태'],
] as const

it.each(publicRoutes)('%s opens its page without a session', (path, title) => {
  renderApp(path, 'out')
  expect(h1()).toBe(title)
})

it.each(protectedRoutes)('%s opens its page when signed in', (path, title) => {
  renderApp(path)
  expect(h1()).toBe(title)
})

it.each(protectedRoutes)('%s sends a signed-out visitor to the login page', (path) => {
  renderApp(path, 'out')
  expect(h1()).toBe('로그인')
})

it('sends the root path to the dashboard when signed in', () => {
  renderApp('/')
  expect(h1()).toBe('대시보드')
})

it('sends the root path to the login page when signed out', () => {
  renderApp('/', 'out')
  expect(h1()).toBe('로그인')
})

it('draws nothing while the stored session is being read', () => {
  renderApp('/profile', 'restoring')
  expect(document.body.textContent).toBe('')
})

it('shows the app bar with the email, links and logout on protected pages', () => {
  renderApp('/dashboard')
  expect(screen.getByText('me@example.com')).toBeTruthy()
  expect(screen.getByRole('link', { name: '대시보드' }).getAttribute('href')).toBe('/dashboard')
  expect(screen.getByRole('link', { name: '프로필' }).getAttribute('href')).toBe('/profile')
  expect(screen.getByRole('link', { name: '내 배포' }).getAttribute('href')).toBe('/deploys')
  expect(screen.getByRole('link', { name: 'WCP' }).getAttribute('href')).toBe('/dashboard')
  expect(screen.getByRole('button', { name: '로그아웃' })).toBeTruthy()
})

it('does not show the app bar on public pages', () => {
  renderApp('/login', 'out')
  expect(screen.queryByRole('button', { name: '로그아웃' })).toBeNull()
})

it('logs out with the button and lands on the plain login page', async () => {
  auth.signOut.mockImplementation(() => {
    emit('SIGNED_OUT', null)
    return Promise.resolve({ error: null })
  })
  renderApp('/dashboard')
  fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
  await waitFor(() => {
    expect(h1()).toBe('로그인')
  })
  expect(auth.signOut).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('로그인 시간이 지났어요')).toBeNull()
})

it('says so when logout fails and stays signed in', async () => {
  auth.signOut.mockResolvedValue({ error: new Error('offline') })
  renderApp('/dashboard')
  fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
  expect(await screen.findByText('로그아웃하지 못했어요')).toBeTruthy()
  expect(h1()).toBe('대시보드')
})

it('removes the logout failure notice once the user goes to another page', async () => {
  auth.signOut.mockResolvedValue({ error: new Error('offline') })
  renderApp('/dashboard')
  fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
  await screen.findByText('로그아웃하지 못했어요')
  fireEvent.click(screen.getByRole('link', { name: '프로필' }))
  expect(h1()).toBe('프로필')
  expect(screen.queryByText('로그아웃하지 못했어요')).toBeNull()
})

it('returns to the page the visitor came for after logging in', async () => {
  auth.signInWithPassword.mockImplementation(() => {
    emit('SIGNED_IN', session)
    return Promise.resolve({ data: {}, error: null })
  })
  renderApp('/profile', 'out')
  expect(h1()).toBe('로그인')
  fireEvent.change(screen.getByRole('textbox', { name: '이메일' }), {
    target: { value: 'me@example.com' },
  })
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'secret' } })
  fireEvent.click(screen.getByRole('button', { name: '로그인' }))
  await waitFor(() => {
    expect(h1()).toBe('프로필')
  })
})

it('shows the expired-session screen and returns to the same page after logging in again', async () => {
  auth.signInWithPassword.mockImplementation(() => {
    emit('SIGNED_IN', session)
    return Promise.resolve({ data: {}, error: null })
  })
  renderApp('/deploy/new')
  emit('SIGNED_OUT', null)
  expect(h1()).toBe('다시 로그인해 주세요')
  expect(screen.getByText('로그인 시간이 지났어요')).toBeTruthy()
  fireEvent.change(screen.getByRole('textbox', { name: '이메일' }), {
    target: { value: 'me@example.com' },
  })
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'secret' } })
  fireEvent.click(screen.getByRole('button', { name: '로그인하고 돌아가기' }))
  await waitFor(() => {
    expect(h1()).toBe('새 배포 요청')
  })
})

// Admin Page(#101): 관리자는 토큰의 app_metadata.role이 admin일 때뿐이다. 판단은 서버가 하고, 화면은 편의로 막는다.
it('opens the Admin Page for an admin and shows the menu link', () => {
  renderApp('/admin', 'in', sessionWith({ role: 'admin' }))
  expect(h1()).toBe('관리자')
  expect(screen.getByRole('link', { name: '관리자' })).toBeTruthy()
})

it('blocks a non-admin from the Admin Page, offers a way back and shows no Admin Page content', () => {
  renderApp('/admin')
  expect(h1()).toBe('권한이 없어요')
  expect(screen.getByRole('link', { name: '대시보드로 가기' }).getAttribute('href')).toBe('/dashboard')
  expect(screen.queryByText('노드 현황')).toBeNull()
})

it('does not show the menu link to a non-admin, nor to a user whose only role is a user_metadata one the user can edit', () => {
  renderApp('/dashboard', 'in', sessionWith({}, { role: 'admin' }))
  expect(screen.queryByRole('link', { name: '관리자' })).toBeNull()
})

it('does not treat another role as admin', () => {
  renderApp('/admin', 'in', sessionWith({ role: 'student' }))
  expect(h1()).toBe('권한이 없어요')
})

it('sends a signed-out visitor to the login screen, not to the forbidden notice', () => {
  renderApp('/admin', 'out')
  expect(h1()).toBe('로그인')
})
