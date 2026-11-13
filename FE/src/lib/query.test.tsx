import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useAdminRead } from '../admin/useAdminRead.ts'
import { AuthContext } from '../auth/auth-context.ts'
import type { AuthState } from '../auth/auth-context.ts'
import SessionCache from '../auth/SessionCache.tsx'
import { useDeploys } from '../deploy/useDeploys.ts'
import { useGithubLink } from '../pages/useGithubLink.ts'
import { makeQueryClient, queryKeys } from './query.ts'

// 실제 BE · Supabase를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('./api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api.ts')>()),
  apiFetch: api.apiFetch,
}))
const auth = vi.hoisted(() => ({ getUserIdentities: vi.fn() }))
vi.mock('./supabase.ts', () => ({ supabase: { auth } }))

const run = { id: 'd1', repo: 'me/a', slug: 'a', commit: 'c', createdAt: '2026-11-13T00:00:00Z', status: 'succeeded', stage: null, url: null }

beforeEach(() => {
  api.apiFetch.mockReset()
  auth.getUserIdentities.mockReset()
})

function Deploys({ label }: { label: string }) {
  const { state } = useDeploys()
  return <p>{`${label}:${state.status === 'ready' ? state.deploys.length : state.status}`}</p>
}

it('shares one read of the deploy list between screens, and a screen opened later shows it at once', async () => {
  api.apiFetch.mockResolvedValue({ deploys: [run] })
  const client = makeQueryClient()
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <Deploys label="dashboard" />
    </QueryClientProvider>,
  )
  expect(await screen.findByText('dashboard:1')).toBeTruthy()
  rerender(
    <QueryClientProvider client={client}>
      <Deploys label="profile" />
    </QueryClientProvider>,
  )
  // 기억해 둔 값이 첫 그림부터 보이고, 15초 안이라 다시 읽지 않는다.
  expect(screen.getByText('profile:1')).toBeTruthy()
  expect(api.apiFetch).toHaveBeenCalledTimes(1)
})

it('shows the remembered list while it reads again once the value is stale, and keeps it if that read fails', async () => {
  api.apiFetch.mockResolvedValueOnce({ deploys: [run] })
  const client = makeQueryClient()
  const view = (label: string) => (
    <QueryClientProvider client={client}>
      <div key={label}>
        <Deploys label={label} />
      </div>
    </QueryClientProvider>
  )
  const { rerender } = render(view('first'))
  await screen.findByText('first:1')
  await act(async () => {
    await client.invalidateQueries({ queryKey: queryKeys.deploys, refetchType: 'none' })
  })
  api.apiFetch.mockRejectedValueOnce(new Error('down'))
  // 다른 화면이 열린다(새로 그려진다).
  rerender(view('second'))
  expect(screen.getByText('second:1')).toBeTruthy()
  await waitFor(() => {
    expect(api.apiFetch).toHaveBeenCalledTimes(2)
  })
  expect(screen.getByText('second:1')).toBeTruthy()
})

it('says failed (not an empty list) when the first read fails', async () => {
  api.apiFetch.mockRejectedValue(new Error('down'))
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <Deploys label="x" />
    </QueryClientProvider>,
  )
  expect(await screen.findByText('x:failed')).toBeTruthy()
})

function Github() {
  const { link } = useGithubLink()
  return <p>{link.status === 'linked' ? `linked:${link.handle}` : link.status}</p>
}

it('reads the GitHub link state once for the dashboard and the profile', async () => {
  auth.getUserIdentities.mockResolvedValue({
    data: { identities: [{ provider: 'github', identity_data: { user_name: 'me' } }] },
    error: null,
  })
  const client = makeQueryClient()
  render(
    <QueryClientProvider client={client}>
      <Github />
      <Github />
    </QueryClientProvider>,
  )
  expect((await screen.findAllByText('linked:me')).length).toBe(2)
  expect(auth.getUserIdentities).toHaveBeenCalledTimes(1)
})

it('treats an error from Supabase as failed', async () => {
  auth.getUserIdentities.mockResolvedValue({ data: null, error: new Error('x') })
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <Github />
    </QueryClientProvider>,
  )
  expect(await screen.findByText('failed')).toBeTruthy()
})

function Admin() {
  const { data } = useAdminRead<{ n: number }>('/api/admin/x')
  return <p>{data ? `n:${data.n}` : 'empty'}</p>
}

it('shows the last admin read at once when the screen is opened again, and refreshes it', async () => {
  api.apiFetch.mockResolvedValueOnce({ n: 1 })
  const client = makeQueryClient()
  const view = (key: string) => (
    <QueryClientProvider client={client}>
      <div key={key}>
        <Admin />
      </div>
    </QueryClientProvider>
  )
  const first = render(view('a'))
  await screen.findByText('n:1')
  first.unmount()
  api.apiFetch.mockResolvedValueOnce({ n: 2 })
  render(view('b'))
  expect(screen.getByText('n:1')).toBeTruthy()
  expect(await screen.findByText('n:2')).toBeTruthy()
})

const signedIn = (id: string): AuthState =>
  ({ status: 'signedIn', session: { access_token: 't', user: { id, email: 'a@b.c', app_metadata: {} } } }) as never
const SIGNED_OUT: AuthState = { status: 'signedOut', expired: false }

function cacheOf(client: ReturnType<typeof makeQueryClient>) {
  const show = (state: AuthState) => (
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={{ state, signOut: () => Promise.resolve() }}>
        <SessionCache />
      </AuthContext.Provider>
    </QueryClientProvider>
  )
  return show
}

it('keeps the remembered reads for the same signed-in user', () => {
  const client = makeQueryClient()
  const show = cacheOf(client)
  client.setQueryData(queryKeys.deploys, [run])
  const view = render(show(signedIn('u1')))
  view.rerender(show(signedIn('u1')))
  expect(client.getQueryData(queryKeys.deploys)).toEqual([run])
})

it('forgets every remembered read when the user logs out', () => {
  const client = makeQueryClient()
  const show = cacheOf(client)
  const view = render(show(signedIn('u1')))
  client.setQueryData(queryKeys.deploys, [run])
  view.rerender(show(SIGNED_OUT))
  expect(client.getQueryData(queryKeys.deploys)).toBeUndefined()
})

it('forgets every remembered read when another user takes over the session', () => {
  const client = makeQueryClient()
  const show = cacheOf(client)
  const view = render(show(signedIn('u1')))
  client.setQueryData(queryKeys.deploys, [run])
  view.rerender(show(signedIn('u2')))
  expect(client.getQueryData(queryKeys.deploys)).toBeUndefined()
})

it('does not forget anything while the stored session is still being read', () => {
  const client = makeQueryClient()
  const show = cacheOf(client)
  client.setQueryData(queryKeys.deploys, [run])
  render(show({ status: 'loading' }))
  expect(client.getQueryData(queryKeys.deploys)).toEqual([run])
})
