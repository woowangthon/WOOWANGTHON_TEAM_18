import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { expect, it } from 'vitest'
import { AuthContext } from '../auth/auth-context.ts'
import AppLayout from './AppLayout.tsx'

const sessionOf = (appMetadata: Record<string, unknown>) =>
  ({ access_token: 't', user: { id: 'u', email: 'me@example.com', app_metadata: appMetadata } }) as never

const show = (appMetadata: Record<string, unknown> = {}) =>
  render(
    <AuthContext.Provider value={{ state: { status: 'signedIn', session: sessionOf(appMetadata) }, signOut: () => Promise.resolve() }}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<p>본문</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )

const header = () => screen.getByRole('banner')
const mainMenu = () => within(screen.getByRole('navigation', { name: '주 메뉴' }))

it('puts only the dashboard and my deploys on the left, and the profile and sign out on the right', () => {
  show()
  expect(mainMenu().getAllByRole('link').map((a) => a.textContent)).toEqual(['대시보드', '내 배포'])
  expect(within(header()).getByRole('link', { name: '프로필' }).getAttribute('href')).toBe('/profile')
  expect(within(header()).getByRole('button', { name: '로그아웃' })).toBeTruthy()
  expect(mainMenu().queryByRole('link', { name: '프로필' })).toBeNull()
  expect(within(header()).getByRole('link', { name: 'WCP' }).getAttribute('href')).toBe('/')
})

it('gives an admin the admin menu with a jump to the alerts, no profile and no onboarding link, and a logo that goes to /admin', () => {
  show({ role: 'admin' })
  expect(mainMenu().getAllByRole('link').map((a) => a.textContent)).toEqual(['관리자', '운영 알림'])
  expect(mainMenu().getByRole('link', { name: '운영 알림' }).getAttribute('href')).toBe('#incidents-heading')
  expect(within(header()).queryByRole('link', { name: '프로필' })).toBeNull()
  expect(within(header()).getByRole('link', { name: 'WCP' }).getAttribute('href')).toBe('/admin')
  expect(screen.queryByRole('link', { name: /설문|기능 소개|지원 범위|사용 방법/ })).toBeNull()
})

it('shows the logo in the footer too', () => {
  show()
  expect(within(screen.getByRole('contentinfo')).getByAltText('WCP')).toBeTruthy()
})
