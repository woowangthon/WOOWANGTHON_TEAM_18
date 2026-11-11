import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import App from '../App.tsx'
import { isAdmin } from '../auth/isAdmin.ts'

// 실제 Supabase를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
type Listener = (event: string, session: unknown) => void
const auth = vi.hoisted(() => ({
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
  getUserIdentities: vi.fn(),
}))
vi.mock('../lib/supabase.ts', () => ({ supabase: { auth } }))

const sessionWith = (appMetadata: Record<string, unknown>, userMetadata: Record<string, unknown> = {}) => ({
  access_token: 'tok',
  user: { email: 'me@example.com', app_metadata: appMetadata, user_metadata: userMetadata },
})
const admin = sessionWith({ role: 'admin' })
const student = sessionWith({})
let emit: (event: string, session: unknown) => void

beforeEach(() => {
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

const renderAt = (path: string, session: unknown) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
  emit('INITIAL_SESSION', session)
}
const h1 = () => screen.getByRole('heading', { level: 1 }).textContent

it('opens the Admin Page for an admin and shows the menu link', () => {
  renderAt('/admin', admin)
  expect(h1()).toBe('관리자')
  expect(screen.getByRole('link', { name: '관리자' })).toBeTruthy()
})

it('blocks a non-admin from the Admin Page and offers a way back, with no Admin Page content', () => {
  renderAt('/admin', student)
  expect(h1()).toBe('권한이 없어요')
  expect(screen.getByRole('link', { name: '대시보드로 가기' }).getAttribute('href')).toBe('/dashboard')
  expect(screen.queryByText('노드 현황')).toBeNull()
})

it('does not show the menu link to a non-admin', () => {
  renderAt('/dashboard', student)
  expect(screen.queryByRole('link', { name: '관리자' })).toBeNull()
})

it('sends a signed-out visitor to the login screen, not to the forbidden notice', () => {
  renderAt('/admin', null)
  expect(h1()).toBe('로그인')
})

it('does not take admin from user_metadata, which the user can edit', () => {
  expect(isAdmin(sessionWith({}, { role: 'admin' }) as never)).toBe(false)
  expect(isAdmin(sessionWith({ role: 'admin' }) as never)).toBe(true)
  expect(isAdmin(sessionWith({ role: 'student' }) as never)).toBe(false)
})
