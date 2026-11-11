import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api.ts'
import SecretForm from './SecretForm.tsx'
import { secretId } from './secrets.ts'
import type { SecretEntry, SecretTarget } from './secrets.ts'

const SERVICES: SecretTarget[] = [
  { service: 'be', keys: ['DATABASE_URL', 'JWT_SECRET'] },
  { service: 'worker', keys: ['QUEUE_URL'] },
]
const none = new Set<string>()
const onSubmit = vi.fn<(entries: SecretEntry[]) => Promise<void>>()

beforeEach(() => {
  onSubmit.mockReset()
  onSubmit.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

const renderForm = (done: ReadonlySet<string> = none, missing: ReadonlySet<string> = none) =>
  render(<SecretForm services={SERVICES} done={done} missing={missing} onSubmit={onSubmit} />)
const input = (name: string) => screen.getByLabelText<HTMLInputElement>(name)
const type = (name: string, value: string) => {
  fireEvent.change(input(name), { target: { value } })
}
const submit = () => {
  fireEvent.click(screen.getByRole('button', { name: '비밀값 저장' }))
}
const fillAll = () => {
  type('DATABASE_URL', 'postgres://u:pw@db/app')
  type('JWT_SECRET', 'jwt-value')
  type('QUEUE_URL', 'queue-value')
}

it('asks for every secret key of every service in a password input that can be revealed', () => {
  renderForm()
  expect(within(screen.getByRole('group', { name: 'be' })).getAllByLabelText(/^(DATABASE_URL|JWT_SECRET)$/)).toHaveLength(2)
  expect(within(screen.getByRole('group', { name: 'worker' })).getByLabelText('QUEUE_URL')).toBeTruthy()
  expect(input('DATABASE_URL').type).toBe('password')
  // 브라우저가 로그인 비밀번호를 대신 채우거나 값을 저장해 두지 않게 한다.
  expect(input('DATABASE_URL').autocomplete).toBe('new-password')
  fireEvent.click(screen.getByRole('button', { name: 'DATABASE_URL 보기' }))
  expect(input('DATABASE_URL').type).toBe('text')
  expect(input('JWT_SECRET').type).toBe('password')
})

it('tells the user the server will not show a value again', () => {
  renderForm()
  expect(screen.getByText(/서버가 다시 보여 주지 않아요/)).toBeTruthy()
})

it('shows keys that are already in by name only, with no input, and asks only for the rest', async () => {
  renderForm(new Set([secretId('be', 'DATABASE_URL')]))
  const be = within(screen.getByRole('group', { name: 'be' }))
  expect(be.getByText('DATABASE_URL')).toBeTruthy()
  expect(be.getByText('들어감')).toBeTruthy()
  expect(screen.queryByLabelText('DATABASE_URL')).toBeNull()
  type('JWT_SECRET', 'jwt-value')
  type('QUEUE_URL', 'queue-value')
  submit()
  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledWith([
      { service: 'be', key: 'JWT_SECRET', value: 'jwt-value' },
      { service: 'worker', key: 'QUEUE_URL', value: 'queue-value' },
    ])
  })
})

it('has no submit button once every key is in', () => {
  renderForm(new Set([secretId('be', 'DATABASE_URL'), secretId('be', 'JWT_SECRET'), secretId('worker', 'QUEUE_URL')]))
  expect(screen.queryByRole('button', { name: '비밀값 저장' })).toBeNull()
  expect(screen.getAllByText('들어감')).toHaveLength(3)
})

it('does not send while a value is blank, names the blank key, and clears the message when typed', () => {
  renderForm()
  type('DATABASE_URL', 'x')
  type('JWT_SECRET', 'y')
  submit()
  expect(onSubmit).not.toHaveBeenCalled()
  const worker = within(screen.getByRole('group', { name: 'worker' }))
  expect(worker.getByText('값을 입력해 주세요')).toBeTruthy()
  expect(input('QUEUE_URL').getAttribute('aria-invalid')).toBe('true')
  expect(within(screen.getByRole('group', { name: 'be' })).queryByText('값을 입력해 주세요')).toBeNull()
  type('QUEUE_URL', 'z')
  expect(screen.queryByText('값을 입력해 주세요')).toBeNull()
})

it('sends all values once and removes them from the screen after the server took them', async () => {
  renderForm()
  fillAll()
  submit()
  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledWith([
      { service: 'be', key: 'DATABASE_URL', value: 'postgres://u:pw@db/app' },
      { service: 'be', key: 'JWT_SECRET', value: 'jwt-value' },
      { service: 'worker', key: 'QUEUE_URL', value: 'queue-value' },
    ])
  })
  await waitFor(() => {
    expect(input('DATABASE_URL').value).toBe('')
  })
  expect(input('JWT_SECRET').value).toBe('')
  expect(input('QUEUE_URL').value).toBe('')
  expect(onSubmit).toHaveBeenCalledTimes(1)
})

it('locks the inputs and the button while sending', async () => {
  let finish: () => void = () => undefined
  onSubmit.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
  renderForm()
  fillAll()
  submit()
  const button = await screen.findByRole<HTMLButtonElement>('button', { name: '저장하는 중…' })
  expect(button.disabled).toBe(true)
  expect(input('DATABASE_URL').disabled).toBe(true)
  finish()
  await waitFor(() => {
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '비밀값 저장' }).disabled).toBe(false)
  })
})

it('shows a key the server said is missing and asks for it again', () => {
  renderForm(new Set([secretId('be', 'DATABASE_URL')]), new Set([secretId('be', 'JWT_SECRET')]))
  const be = within(screen.getByRole('group', { name: 'be' }))
  expect(be.getByText('서버에 들어가지 않았어요. 다시 입력해 주세요')).toBeTruthy()
  expect(input('JWT_SECRET').getAttribute('aria-invalid')).toBe('true')
  expect(within(screen.getByRole('group', { name: 'worker' })).queryByRole('alert')).toBeNull()
})

it('keeps what was typed and says it is not the user fault on 503, then sends the same values again', async () => {
  onSubmit.mockRejectedValueOnce(new ApiError(503, 'LEADER_UNAVAILABLE', 'x'))
  renderForm()
  fillAll()
  submit()
  expect(await screen.findByText('지금은 값을 저장할 수 없어요')).toBeTruthy()
  expect(screen.getByText(/사용자 잘못이 아니에요/)).toBeTruthy()
  expect(input('DATABASE_URL').value).toBe('postgres://u:pw@db/app')
  expect(input('QUEUE_URL').value).toBe('queue-value')

  submit()
  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })
  expect(onSubmit.mock.calls[1]).toEqual(onSubmit.mock.calls[0])
  await waitFor(() => {
    expect(screen.queryByText('지금은 값을 저장할 수 없어요')).toBeNull()
  })
})

it('keeps what was typed on any other failure and does not echo the error message or the values', async () => {
  onSubmit.mockRejectedValueOnce(new Error('upstream said postgres://u:pw@db/app'))
  renderForm()
  fillAll()
  submit()
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('값을 저장하지 못했어요')
  expect(document.body.textContent).not.toContain('postgres://u:pw@db/app')
  expect(input('JWT_SECRET').value).toBe('jwt-value')
})

it('never writes a value to storage, the address bar or the console', async () => {
  const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m))
  onSubmit.mockRejectedValueOnce(new ApiError(503, 'X', 'postgres://u:pw@db/app'))
  const before = window.location.href
  renderForm()
  fillAll()
  submit()
  await screen.findByText('지금은 값을 저장할 수 없어요')
  submit()
  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })
  const dump = [JSON.stringify({ ...window.localStorage }), JSON.stringify({ ...window.sessionStorage }), window.location.href]
  for (const text of dump) expect(text).not.toMatch(/postgres|jwt-value|queue-value/)
  expect(window.location.href).toBe(before)
  for (const spy of consoles) expect(JSON.stringify(spy.mock.calls)).not.toMatch(/postgres|jwt-value|queue-value/)
})
