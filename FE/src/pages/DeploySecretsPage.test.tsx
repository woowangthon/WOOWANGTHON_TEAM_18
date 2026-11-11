import { act, fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import DeploySecretsPage from './DeploySecretsPage.tsx'

// 실제 BE를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  apiFetch: api.apiFetch,
}))

beforeEach(() => {
  api.apiFetch.mockReset()
})

it('does not keep what was typed for the previous deploy when the id changes', async () => {
  const missing = { ready: false, secretHash: null, services: [{ name: 'be', status: 'missing', keys: [{ key: 'DATABASE_URL', status: 'missing' }] }] }
  api.apiFetch.mockResolvedValue(missing)
  render(
    <MemoryRouter initialEntries={['/deploys/a/secrets']}>
      <Routes>
        <Route
          path="/deploys/:id/secrets"
          element={
            <>
              <DeploySecretsPage />
              <Link to="/deploys/b/secrets">go</Link>
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  const field = await screen.findByLabelText<HTMLInputElement>('DATABASE_URL')
  fireEvent.change(field, { target: { value: 'secret-of-a' } })
  expect(field.value).toBe('secret-of-a')
  fireEvent.click(screen.getByRole('link', { name: 'go' }))
  await act(async () => {
    await Promise.resolve()
  })
  expect(api.apiFetch).toHaveBeenCalledWith('/api/deploys/b/secrets')
  expect((await screen.findByLabelText<HTMLInputElement>('DATABASE_URL')).value).toBe('')
})
