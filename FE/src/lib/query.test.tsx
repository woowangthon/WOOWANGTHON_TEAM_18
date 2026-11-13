import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
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

it('shows the remembered deploy list at once on a screen opened later, and reads it again behind it', async () => {
  api.apiFetch.mockResolvedValueOnce({ deploys: [run] })
  const client = makeQueryClient()
  const view = (label: string) => (
    <QueryClientProvider client={client}>
      <div key={label}>
        <Deploys label={label} />
      </div>
    </QueryClientProvider>
  )
  const { rerender } = render(view('dashboard'))
  expect(await screen.findByText('dashboard:1')).toBeTruthy()
  api.apiFetch.mockResolvedValueOnce({ deploys: [run, { ...run, id: 'd2' }] })
  rerender(view('profile'))
  // 기억해 둔 값이 첫 그림부터 보이고, 뒤에서 새로 읽어 바뀐 목록으로 고친다(만든 · 시작한 배포가 늦게 보이지 않는다).
  expect(screen.getByText('profile:1')).toBeTruthy()
  expect(await screen.findByText('profile:2')).toBeTruthy()
  expect(api.apiFetch).toHaveBeenCalledTimes(2)
})

it('shares one read between two consumers mounted together', async () => {
  api.apiFetch.mockResolvedValue({ deploys: [run] })
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <Deploys label="a" />
      <Deploys label="b" />
    </QueryClientProvider>,
  )
  expect(await screen.findByText('a:1')).toBeTruthy()
  expect(screen.getByText('b:1')).toBeTruthy()
  expect(api.apiFetch).toHaveBeenCalledTimes(1)
})

it('keeps the remembered list when the read behind it fails', async () => {
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
  api.apiFetch.mockRejectedValueOnce(new Error('down'))
  rerender(view('second'))
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

it('reads nothing, not even on reload, while paused', () => {
  function Paused() {
    const { reload } = useAdminRead<{ n: number }>('/api/admin/y', true)
    return (
      <button type="button" onClick={reload}>
        reload
      </button>
    )
  }
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <Paused />
    </QueryClientProvider>,
  )
  screen.getByRole('button', { name: 'reload' }).click()
  expect(api.apiFetch).not.toHaveBeenCalled()
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

it('does not keep showing the previous user\'s deploy list on a screen that stays open when another user takes over', async () => {
  api.apiFetch.mockResolvedValueOnce({ deploys: [run] }).mockResolvedValueOnce({ deploys: [] })
  const client = makeQueryClient()
  // 실제 앱처럼 열린 화면은 같은 element라서 사용자가 바뀌어도 다시 그려지지 않는다.
  const openScreen = <Deploys label="open" />
  const show = (state: AuthState) => (
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={{ state, signOut: () => Promise.resolve() }}>
        <SessionCache />
        {openScreen}
      </AuthContext.Provider>
    </QueryClientProvider>
  )
  const view = render(show(signedIn('u1')))
  expect(await screen.findByText('open:1')).toBeTruthy()
  view.rerender(show(signedIn('u2')))
  expect(await screen.findByText('open:0')).toBeTruthy()
  expect(api.apiFetch).toHaveBeenCalledTimes(2)
})

it('does not forget anything while the stored session is still being read', () => {
  const client = makeQueryClient()
  const show = cacheOf(client)
  client.setQueryData(queryKeys.deploys, [run])
  render(show({ status: 'loading' }))
  expect(client.getQueryData(queryKeys.deploys)).toEqual([run])
})
