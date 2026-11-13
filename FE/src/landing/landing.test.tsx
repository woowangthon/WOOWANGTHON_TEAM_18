import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Session } from '@supabase/supabase-js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthContext, type AuthState } from '../auth/auth-context.ts'
import LandingPage from '../pages/LandingPage.tsx'
import HeroCarousel, { CAROUSEL_MS } from './HeroCarousel.tsx'

const caption = () => screen.getByText(/^\d \/ 4$/).textContent
const advance = (ms: number) => {
  void act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function mockMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce'), media: query }))
}

beforeEach(() => {
  vi.useFakeTimers()
  mockMotion(false)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('moves to the next of four steps every 5 seconds and wraps around', () => {
  render(<HeroCarousel />)
  expect(caption()).toBe('1 / 4')
  advance(CAROUSEL_MS)
  expect(caption()).toBe('2 / 4')
  advance(CAROUSEL_MS * 3)
  expect(caption()).toBe('1 / 4')
})

it('announces the caption politely and names the carousel', () => {
  render(<HeroCarousel />)
  expect(screen.getByRole('group', { name: '배포 흐름 4단계' }).getAttribute('aria-roledescription')).toBe('캐러셀')
  expect(screen.getByText('1 / 4').closest('[aria-live]')?.getAttribute('aria-live')).toBe('polite')
})

it('jumps to a step from its dot button', () => {
  render(<HeroCarousel />)
  fireEvent.click(screen.getByRole('button', { name: /^3단계 보기/ }))
  expect(caption()).toBe('3 / 4')
})

it('pauses while hovered and resumes after', () => {
  render(<HeroCarousel />)
  const region = screen.getByRole('group', { name: '배포 흐름 4단계' })
  fireEvent.pointerEnter(region, { pointerType: 'mouse' })
  advance(CAROUSEL_MS * 3)
  expect(caption()).toBe('1 / 4')
  fireEvent.pointerLeave(region, { pointerType: 'mouse' })
  advance(CAROUSEL_MS)
  expect(caption()).toBe('2 / 4')
})

it('does not pause for a touch', () => {
  render(<HeroCarousel />)
  fireEvent.pointerEnter(screen.getByRole('group', { name: '배포 흐름 4단계' }), { pointerType: 'touch' })
  advance(CAROUSEL_MS)
  expect(caption()).toBe('2 / 4')
})

it('pauses while focus is inside and resumes when it leaves', () => {
  render(<HeroCarousel />)
  const dot = screen.getByRole('button', { name: /^2단계 보기/ })
  fireEvent.focus(dot)
  advance(CAROUSEL_MS * 3)
  expect(caption()).toBe('1 / 4')
  fireEvent.blur(dot)
  advance(CAROUSEL_MS)
  expect(caption()).toBe('2 / 4')
})

it('stops on the pause button and starts again on the same button', () => {
  render(<HeroCarousel />)
  fireEvent.click(screen.getByRole('button', { name: '자동 넘김 멈추기' }))
  advance(CAROUSEL_MS * 2)
  expect(caption()).toBe('1 / 4')
  fireEvent.click(screen.getByRole('button', { name: '자동 넘김 켜기' }))
  advance(CAROUSEL_MS)
  expect(caption()).toBe('2 / 4')
})

it('does not advance by itself when the visitor prefers reduced motion', () => {
  mockMotion(true)
  render(<HeroCarousel />)
  advance(CAROUSEL_MS * 4)
  expect(caption()).toBe('1 / 4')
  fireEvent.click(screen.getByRole('button', { name: '자동 넘김 켜기' }))
  fireEvent.click(screen.getByRole('button', { name: /^4단계 보기/ }))
  expect(caption()).toBe('4 / 4')
})

const sessionWith = (appRole?: string) =>
  ({ user: { id: 'u', email: 'a@b.c', app_metadata: appRole ? { role: appRole } : {}, user_metadata: {} } }) as unknown as Session
const renderLanding = (state: AuthState) =>
  render(
    <AuthContext.Provider value={{ state, signOut: vi.fn() }}>
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  )

it('shows login and start links to a signed-out visitor', () => {
  renderLanding({ status: 'signedOut', expired: false })
  expect(screen.getByRole('link', { name: '로그인' }).getAttribute('href')).toBe('/login')
  expect(screen.queryByRole('link', { name: '대시보드로' })).toBeNull()
})

it('shows a dashboard link instead of login and start to a signed-in student', () => {
  renderLanding({ status: 'signedIn', session: sessionWith() })
  for (const link of screen.getAllByRole('link', { name: '대시보드로' })) expect(link.getAttribute('href')).toBe('/dashboard')
  expect(screen.queryByRole('link', { name: '로그인' })).toBeNull()
  expect(screen.queryByRole('link', { name: '시작하기' })).toBeNull()
})

it('sends an admin to /admin', () => {
  renderLanding({ status: 'signedIn', session: sessionWith('admin') })
  for (const link of screen.getAllByRole('link', { name: '대시보드로' })) expect(link.getAttribute('href')).toBe('/admin')
})

it('draws nothing while the session is loading', () => {
  const { container } = renderLanding({ status: 'loading' })
  expect(container.textContent).toBe('')
})

it('labels every preview as an example', () => {
  renderLanding({ status: 'signedOut', expired: false })
  expect(screen.getAllByText('예시 화면')).toHaveLength(5)
})
