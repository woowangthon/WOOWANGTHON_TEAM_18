import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import AuthProvider from './AuthProvider.tsx'
import { readLoginState } from './login-state.ts'
import { useAuth } from './useAuth.ts'

// 실제 Supabase를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
type Listener = (event: string, session: unknown) => void
const auth = vi.hoisted(() => ({
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('../lib/supabase.ts', () => ({ supabase: { auth } }))

const unsubscribe = vi.fn()
let emit: Listener
const session = { access_token: 'tok', user: { email: 'me@example.com' } }

beforeEach(() => {
  unsubscribe.mockReset()
  auth.signOut.mockReset().mockResolvedValue({ error: null })
  auth.onAuthStateChange.mockReset().mockImplementation((listener: Listener) => {
    emit = (event, next) => {
      act(() => {
        listener(event, next)
      })
    }
    return { data: { subscription: { unsubscribe } } }
  })
})

function Probe() {
  const { state, signOut } = useAuth()
  return (
    <>
      <p data-testid="state">
        {state.status === 'signedOut'
          ? `signedOut expired=${String(state.expired)}`
          : state.status === 'signedIn'
            ? `signedIn ${state.session.user.email ?? ''}`
            : 'loading'}
      </p>
      <button
        onClick={() => {
          signOut().catch(() => undefined)
        }}
      >
        out
      </button>
    </>
  )
}

const renderProbe = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
const status = () => screen.getByTestId('state').textContent

it('stays loading until the stored session is read, then restores it', () => {
  renderProbe()
  expect(status()).toBe('loading')
  emit('INITIAL_SESSION', session)
  expect(status()).toBe('signedIn me@example.com')
})

it('is signed out, not expired, when there is no stored session', () => {
  renderProbe()
  emit('INITIAL_SESSION', null)
  expect(status()).toBe('signedOut expired=false')
})

it('marks the session expired when it ends without the logout button', () => {
  renderProbe()
  emit('INITIAL_SESSION', session)
  emit('SIGNED_OUT', null)
  expect(status()).toBe('signedOut expired=true')
})

it('keeps expired when another sign-out event arrives while signed out', () => {
  renderProbe()
  emit('INITIAL_SESSION', session)
  emit('SIGNED_OUT', null)
  emit('SIGNED_OUT', null)
  expect(status()).toBe('signedOut expired=true')
})

it('is not expired when the user pressed logout', async () => {
  auth.signOut.mockImplementation(() => {
    emit('SIGNED_OUT', null)
    return Promise.resolve({ error: null })
  })
  renderProbe()
  emit('INITIAL_SESSION', session)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'out' }))
    await Promise.resolve()
  })
  expect(status()).toBe('signedOut expired=false')
})

// 실제 supabase-js는 signOut이 끝나기 전에 이벤트를 주지만 React는 그 상태를 나중에 그린다.
// 이벤트 시점의 "내가 눌렀다"를 기억해 두지 않으면 렌더 때는 이미 지워져 만료로 오해한다.
it('is not expired when the state is applied after signOut has already resolved', async () => {
  let listener: Listener | undefined
  auth.onAuthStateChange.mockImplementation((next: Listener) => {
    listener = next
    return { data: { subscription: { unsubscribe } } }
  })
  auth.signOut.mockImplementation(async () => {
    // 서버 응답을 기다린 뒤에 이벤트가 온다(클릭 처리 중이 아니라서 React가 바로 그리지 않는다).
    await Promise.resolve()
    listener?.('TOKEN_REFRESHED', session)
    listener?.('SIGNED_OUT', null)
    return { error: null }
  })
  renderProbe()
  act(() => {
    listener?.('INITIAL_SESSION', session)
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'out' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(status()).toBe('signedOut expired=false')
})

it('lets a later expiry show after a logout that failed', async () => {
  auth.signOut.mockResolvedValue({ error: new Error('offline') })
  renderProbe()
  emit('INITIAL_SESSION', session)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'out' }))
    await Promise.resolve()
  })
  expect(status()).toBe('signedIn me@example.com')
  emit('SIGNED_OUT', null)
  expect(status()).toBe('signedOut expired=true')
})

it('clears expired after signing in again', () => {
  renderProbe()
  emit('INITIAL_SESSION', session)
  emit('SIGNED_OUT', null)
  emit('SIGNED_IN', session)
  expect(status()).toBe('signedIn me@example.com')
})

it('unsubscribes when it unmounts', () => {
  const { unmount } = renderProbe()
  expect(unsubscribe).not.toHaveBeenCalled()
  unmount()
  expect(unsubscribe).toHaveBeenCalledTimes(1)
})

it('useAuth throws outside the provider', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  expect(() => render(<Probe />)).toThrow('useAuth must be used inside AuthProvider')
  log.mockRestore()
})

it('readLoginState keeps an internal path and ignores everything else', () => {
  expect(readLoginState({ from: '/profile?a=1#x', expired: true })).toEqual({
    from: '/profile?a=1#x',
    expired: true,
  })
  expect(readLoginState(null)).toEqual({})
  expect(readLoginState('x')).toEqual({})
  expect(readLoginState({ from: '//evil.example', expired: 'yes' })).toEqual({
    from: undefined,
    expired: false,
  })
  expect(readLoginState({ from: '/\\evil.example' }).from).toBeUndefined()
  expect(readLoginState({ from: 'https://evil.example' }).from).toBeUndefined()
  expect(readLoginState({ from: 42 }).from).toBeUndefined()
  // 브라우저는 URL의 탭 · 줄바꿈을 지우므로 `/\t/host`는 `//host`와 같다.
  expect(readLoginState({ from: '/\t/evil.example' }).from).toBeUndefined()
  expect(readLoginState({ from: '/a\nb' }).from).toBeUndefined()
  expect(readLoginState({ from: '/a b' }).from).toBeUndefined()
})
