import { act, fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WithQuery } from '../test-utils.tsx'
import DeployProgressPage from './DeployProgressPage.tsx'

// 실제 BE를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  apiFetch: api.apiFetch,
}))


// 운영 알림 배너는 자기 시험(incidents/IncidentNotice.test.tsx)이 있다. 여기서는 어느 배포의 것으로 부르는지만 본다.
vi.mock('../incidents/IncidentNotice.tsx', () => ({ default: ({ deployId }: { deployId: string }) => <p>운영 알림 {deployId}</p> }))

beforeEach(() => {
  vi.useFakeTimers()
  api.apiFetch.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

const steps = (state: string) =>
  ['intake', 'analysis', 'config', 'secrets', 'build', 'deploy', 'verify', 'done'].map((key) => ({ key, state }))

it('does not show the previous deploy while the next one is loading', async () => {
  api.apiFetch.mockImplementation((path: string) =>
    path === '/api/deploys/a/status'
      ? Promise.resolve({ deployId: 'a', status: 'succeeded', stage: null, steps: steps('done'), failure: null, url: 'https://a.stairnoworks.com', warnings: [], updatedAt: '' })
      : new Promise(() => undefined),
  )
  render(
    <WithQuery>
    <MemoryRouter initialEntries={['/deploys/a']}>
      <Routes>
        <Route
          path="/deploys/:id"
          element={
            <>
              <DeployProgressPage />
              <Link to="/deploys/b">go</Link>
            </>
          }
        />
      </Routes>
    </MemoryRouter>
    </WithQuery>,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(screen.getByRole('link', { name: 'https://a.stairnoworks.com' })).toBeTruthy()
  fireEvent.click(screen.getByRole('link', { name: 'go' }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(screen.queryByRole('link', { name: 'https://a.stairnoworks.com' })).toBeNull()
  expect(screen.getByText('진행 상태를 불러오는 중…')).toBeTruthy()
})
