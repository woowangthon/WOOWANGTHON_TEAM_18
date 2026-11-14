import { act, fireEvent, render, screen, within } from '@testing-library/react'
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

it('moves to the next of four steps every CAROUSEL_MS (6 to 7 seconds) and wraps around', () => {
  render(<HeroCarousel />)
  expect(caption()).toBe('1 / 4')
  advance(CAROUSEL_MS)
  expect(caption()).toBe('2 / 4')
  advance(CAROUSEL_MS * 3)
  expect(caption()).toBe('1 / 4')
})

it('advances slower than 5 seconds and faster than 10', () => {
  expect(CAROUSEL_MS).toBeGreaterThanOrEqual(6000)
  expect(CAROUSEL_MS).toBeLessThanOrEqual(7000)
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
  expect(screen.getAllByRole('link', { name: '로그인' })[0]?.getAttribute('href')).toBe('/login')
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

it('explains each service type in plain words with examples and what you get', () => {
  renderLanding({ status: 'signedOut', expired: false })
  expect(screen.getByRole('heading', { name: '정적 웹' })).toBeTruthy()
  expect(screen.getByText(/서버 없이 브라우저가 그대로 보여 줘요/)).toBeTruthy()
  expect(screen.getByText('동아리 홈페이지 + API')).toBeTruthy()
  expect(screen.getByText('웹 주소와 API 경로')).toBeTruthy()
})

it('says only React (Vite) and Next.js work without a Dockerfile, and does not claim a tested language list', () => {
  renderLanding({ status: 'signedOut', expired: false })
  expect(screen.getByText(/React\(Vite\)와 Next\.js를 올릴 수 있어요/)).toBeTruthy()
  expect(screen.getByText(/시험해 본 목록은 아니에요/)).toBeTruthy()
})

it('shows the real survey numbers with their source and pairs each with an answer', () => {
  renderLanding({ status: 'signedOut', expired: false })
  expect(screen.getByText('출처: 학과 대상 구글폼 설문 · 2026-10-28~31 · 응답 37명')).toBeTruthy()
  expect(screen.getByText('37명 중 29명 (78%)')).toBeTruthy()
  expect(screen.getByText('37명 중 25명 (68%)')).toBeTruthy()
  expect(screen.getByText('22명 중 7명 (32%)')).toBeTruthy()
  expect(screen.getByText('37명 중 16명 (43%)')).toBeTruthy()
  expect(screen.getByText('37명 중 28명 (76%)')).toBeTruthy()
  expect(screen.getByText(/37명 모두 긍정이에요 · 사용하고 싶다 26명, 기회가 되면 쓰겠다 11명/)).toBeTruthy()
  expect(screen.getAllByText('우리의 답')).toHaveLength(5)
  expect(screen.getAllByRole('progressbar').length).toBeGreaterThanOrEqual(6)
})

it('closes with a call to action: start and login when signed out, dashboard when signed in', () => {
  const { unmount } = renderLanding({ status: 'signedOut', expired: false })
  expect(screen.getByRole('heading', { name: '첫 배포, 지금 해 보세요' })).toBeTruthy()
  expect(screen.getAllByRole('link', { name: '시작하기' })).toHaveLength(3)
  unmount()
  renderLanding({ status: 'signedIn', session: sessionWith('admin') })
  expect(screen.getAllByRole('link', { name: '대시보드로' })).toHaveLength(3)
})

it('shows the auto-advance toggle as an icon button that keeps its name', () => {
  render(<HeroCarousel />)
  const pause = screen.getByRole('button', { name: '자동 넘김 멈추기' })
  expect(pause.textContent).toBe('')
  expect(pause.querySelector('svg')).toBeTruthy()
})

it('steps with the arrow buttons on both sides and wraps around', () => {
  render(<HeroCarousel />)
  fireEvent.click(screen.getByRole('button', { name: '이전 단계' }))
  expect(caption()).toBe('4 / 4')
  fireEvent.click(screen.getByRole('button', { name: '다음 단계' }))
  expect(caption()).toBe('1 / 4')
  fireEvent.click(screen.getByRole('button', { name: '다음 단계' }))
  expect(caption()).toBe('2 / 4')
})

const swipe = (from: number, to: number) => {
  const area = screen.getByRole('button', { name: '다음 단계' }).parentElement as HTMLElement
  fireEvent.pointerDown(area, { clientX: from, pointerId: 1 })
  fireEvent.pointerUp(area, { clientX: to, pointerId: 1 })
}

it('goes to the next step on a drag to the left and to the previous on a drag to the right', () => {
  render(<HeroCarousel />)
  swipe(200, 100)
  expect(caption()).toBe('2 / 4')
  swipe(100, 200)
  expect(caption()).toBe('1 / 4')
})

it('ignores a drag shorter than the threshold', () => {
  render(<HeroCarousel />)
  swipe(200, 180)
  expect(caption()).toBe('1 / 4')
})

it('gives a manually opened step its full time before the automatic advance', () => {
  render(<HeroCarousel />)
  advance(CAROUSEL_MS - 1000)
  fireEvent.click(screen.getByRole('button', { name: '다음 단계' }))
  expect(caption()).toBe('2 / 4')
  advance(CAROUSEL_MS - 1)
  expect(caption()).toBe('2 / 4')
  advance(1)
  expect(caption()).toBe('3 / 4')
})

it('does not treat a press that starts on an arrow button as a drag', () => {
  render(<HeroCarousel />)
  const next = screen.getByRole('button', { name: '다음 단계' })
  fireEvent.pointerDown(next, { clientX: 200, pointerId: 1 })
  fireEvent.pointerUp(next.parentElement as HTMLElement, { clientX: 100, pointerId: 1 })
  expect(caption()).toBe('1 / 4')
})

it('keeps the section links out of the top bar and in a floating menu, the same for every sign-in state', () => {
  for (const state of [{ status: 'signedOut', expired: false }, { status: 'signedIn', session: sessionWith() }] as AuthState[]) {
    const { unmount } = renderLanding(state)
    const bar = screen.getByRole('banner')
    expect(within(bar).queryByRole('link', { name: /설문|기능 소개|지원 범위|사용 방법/ })).toBeNull()
    const menu = within(screen.getByRole('navigation', { name: '페이지 바로가기' }))
    expect(menu.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['설문', '#survey'],
      ['기능 소개', '#showcase'],
      ['지원 범위', '#types'],
      ['사용 방법', '#how'],
    ])
    unmount()
  }
})

it('shows the logo in the footer and keeps every section on the same side margins as the top bar', () => {
  const { container } = renderLanding({ status: 'signedOut', expired: false })
  expect(within(screen.getByRole('contentinfo')).getByAltText('WCP')).toBeTruthy()
  // 상단 바와 본문 구역이 같은 좌우 여백(px-3 sm:px-4)이어야 로고와 본문 가장자리가 맞는다.
  expect(container.innerHTML).not.toContain('sm:px-8')
})
