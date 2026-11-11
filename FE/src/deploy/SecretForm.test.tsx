import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api.ts'
import SecretForm from './SecretForm.tsx'
import type { SecretEntry, SecretTarget } from './secrets.ts'

const KEYS = { be: ['DATABASE_URL', 'JWT_SECRET'], worker: ['QUEUE_URL'] }
const DB = 'postgres://u:pw@db/app'
const LEAK = /postgres|jwt-value|queue-value/
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

// done: 서버에 들어가 있는 서비스 이름. 적지 않은 서비스는 아직 안 들어간 것이다.
const targets = (done: string[]): SecretTarget[] =>
  Object.entries(KEYS).map(([service, keys]) => ({ service, keys, done: done.includes(service) }))
const renderForm = (done: string[] = []) =>
  render(<SecretForm services={targets(done)} onSubmit={onSubmit} />)
const input = (name: string) => screen.getByLabelText<HTMLInputElement>(name)
const type = (name: string, value: string) => {
  fireEvent.change(input(name), { target: { value } })
}
const submit = () => {
  fireEvent.click(screen.getByRole('button', { name: '비밀값 저장' }))
}
const fillAll = () => {
  type('DATABASE_URL', DB)
  type('JWT_SECRET', 'jwt-value')
  type('QUEUE_URL', 'queue-value')
}
const ENTRIES: SecretEntry[] = [
  { service: 'be', key: 'DATABASE_URL', value: DB },
  { service: 'be', key: 'JWT_SECRET', value: 'jwt-value' },
  { service: 'worker', key: 'QUEUE_URL', value: 'queue-value' },
]

it('asks for every secret key of every service in a password input that can be revealed', () => {
  renderForm()
  const be = within(screen.getByRole('group', { name: 'be' }))
  expect(be.getByLabelText('DATABASE_URL')).toBeTruthy()
  expect(be.getByLabelText('JWT_SECRET')).toBeTruthy()
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

it('shows a service that is already in by its key names only, and asks only for the other service, with all its keys', () => {
  renderForm(['be'])
  const be = within(screen.getByRole('group', { name: /be/ }))
  expect(be.getByText('들어감')).toBeTruthy()
  expect(be.getByText('DATABASE_URL')).toBeTruthy()
  expect(be.getByText('JWT_SECRET')).toBeTruthy()
  expect(screen.queryByLabelText('DATABASE_URL')).toBeNull()
  type('QUEUE_URL', 'queue-value')
  submit()
  expect(onSubmit).toHaveBeenCalledWith([{ service: 'worker', key: 'QUEUE_URL', value: 'queue-value' }])
})

it('has no submit button once every service is in', () => {
  renderForm(['be', 'worker'])
  expect(screen.queryByRole('button', { name: '비밀값 저장' })).toBeNull()
  expect(screen.getAllByText('들어감')).toHaveLength(2)
})

it.each([['empty', ''], ['whitespace only', ' \n\t ']])('does not send while a value is %s, names the key, and clears the message when typed', (_name, blank) => {
  renderForm()
  type('DATABASE_URL', 'x')
  type('JWT_SECRET', 'y')
  type('QUEUE_URL', blank)
  submit()
  expect(onSubmit).not.toHaveBeenCalled()
  expect(within(screen.getByRole('group', { name: 'worker' })).getByText('입력해 주세요')).toBeTruthy()
  expect(input('QUEUE_URL').getAttribute('aria-invalid')).toBe('true')
  expect(within(screen.getByRole('group', { name: 'be' })).queryByText('입력해 주세요')).toBeNull()
  type('QUEUE_URL', 'z')
  expect(screen.queryByText('입력해 주세요')).toBeNull()
})

// 한 줄 입력칸(password)은 줄바꿈을 값에서 지운다. 줄바꿈이 든 값(예: PEM 키)은 이 입력칸으로 넣을 수 없다.
it('sends a value exactly as typed, with its leading and trailing spaces', async () => {
  renderForm(['be'])
  type('QUEUE_URL', '  q v  ')
  submit()
  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledWith([{ service: 'worker', key: 'QUEUE_URL', value: '  q v  ' }])
  })
})

it('sends all keys of all services that are not in yet, once, and removes the values after the server took them', async () => {
  renderForm()
  fillAll()
  submit()
  expect(onSubmit).toHaveBeenCalledWith(ENTRIES)
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

it('keeps the errors of the other services when one service change is cancelled', () => {
  renderForm(['be'])
  fireEvent.click(screen.getByRole('button', { name: 'be 값 바꾸기' }))
  submit()
  expect(screen.getAllByText('입력해 주세요')).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: 'be 값 바꾸기 취소' }))
  expect(screen.getAllByText('입력해 주세요')).toHaveLength(1)
})

it('lets the user change a service that is already in by typing all its keys again, and cancel without sending it', async () => {
  renderForm(['be', 'worker'])
  fireEvent.click(screen.getByRole('button', { name: 'be 값 바꾸기' }))
  expect(input('DATABASE_URL').value).toBe('')
  expect(input('JWT_SECRET').value).toBe('')
  expect(screen.queryByLabelText('QUEUE_URL')).toBeNull()
  type('DATABASE_URL', 'a')
  fireEvent.click(screen.getByRole('button', { name: 'be 값 바꾸기 취소' }))
  expect(screen.queryByLabelText('DATABASE_URL')).toBeNull()
  expect(screen.queryByRole('button', { name: '비밀값 저장' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'be 값 바꾸기' }))
  expect(input('DATABASE_URL').value).toBe('')
  type('DATABASE_URL', 'a')
  type('JWT_SECRET', 'b')
  submit()
  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledWith([
      { service: 'be', key: 'DATABASE_URL', value: 'a' },
      { service: 'be', key: 'JWT_SECRET', value: 'b' },
    ])
  })
  await waitFor(() => {
    expect(screen.queryByLabelText('DATABASE_URL')).toBeNull()
  })
})

it('drops the typed values of a service once the parent says it is in', () => {
  const { rerender } = renderForm()
  type('DATABASE_URL', 'a')
  type('QUEUE_URL', 'q')
  rerender(<SecretForm services={targets(['be'])} onSubmit={onSubmit} />)
  rerender(<SecretForm services={targets([])} onSubmit={onSubmit} />)
  expect(input('DATABASE_URL').value).toBe('')
  expect(input('QUEUE_URL').value).toBe('q')
})

it.each([
  ['503', new ApiError(503, 'CLUSTER_UNAVAILABLE', 'x')],
  ['a request that never reached the server', new ApiError(0, 'NETWORK_ERROR', 'x')],
])('keeps what was typed and says it is not the user fault on %s, then sends the same values again', async (_name, error) => {
  onSubmit.mockRejectedValueOnce(error)
  renderForm()
  fillAll()
  submit()
  expect(await screen.findByText('지금은 값을 저장할 수 없어요')).toBeTruthy()
  expect(screen.getByText(/사용자 잘못이 아니에요/)).toBeTruthy()
  expect(input('DATABASE_URL').value).toBe(DB)
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

it('puts the server problem on the value it names, keeps all the values and says nothing else', async () => {
  onSubmit.mockRejectedValueOnce(
    new ApiError(400, 'INVALID_SECRETS', 'x', [
      { path: 'secrets.be.JWT_SECRET', code: 'OUT_OF_RANGE' },
      { path: 'secrets.worker.QUEUE_URL', code: 'REQUIRED' },
    ]),
  )
  renderForm()
  fillAll()
  submit()
  const be = within(await screen.findByRole('group', { name: 'be' }))
  expect(be.getByText(/값이 너무 길어요. 8,192자까지/)).toBeTruthy()
  expect(within(screen.getByRole('group', { name: 'worker' })).getByText('입력해 주세요')).toBeTruthy()
  expect(input('JWT_SECRET').getAttribute('aria-invalid')).toBe('true')
  expect(input('DATABASE_URL').getAttribute('aria-invalid')).toBeNull()
  expect(input('DATABASE_URL').value).toBe(DB)
  expect(screen.queryByText('값을 저장하지 못했어요')).toBeNull()
})

it('says a generic failure when the server problem does not point at a value, and keeps the values', async () => {
  onSubmit.mockRejectedValueOnce(new ApiError(400, 'INVALID_SECRETS', 'x', [{ path: 'secrets.ghost', code: 'UNKNOWN_SERVICE' }]))
  renderForm()
  fillAll()
  submit()
  expect(await screen.findByText('값을 저장하지 못했어요')).toBeTruthy()
  expect(input('JWT_SECRET').value).toBe('jwt-value')
})

it('drops the old failure notice when a later submit is blocked by a blank value', async () => {
  onSubmit.mockRejectedValueOnce(new ApiError(503, 'X', 'x'))
  renderForm()
  fillAll()
  submit()
  await screen.findByText('지금은 값을 저장할 수 없어요')
  type('QUEUE_URL', '')
  submit()
  expect(screen.getByText('입력해 주세요')).toBeTruthy()
  expect(screen.queryByText('지금은 값을 저장할 수 없어요')).toBeNull()
  expect(onSubmit).toHaveBeenCalledTimes(1)
})

it('keeps what was typed on any other failure and does not echo the error message or the values', async () => {
  onSubmit.mockRejectedValueOnce(new Error(`upstream said ${DB}`))
  renderForm()
  fillAll()
  submit()
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('값을 저장하지 못했어요')
  expect(document.body.textContent).not.toContain(DB)
  expect(input('JWT_SECRET').value).toBe('jwt-value')
})

it('never writes a value to storage, the address bar or the console', async () => {
  const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m))
  onSubmit.mockRejectedValueOnce(new ApiError(503, 'X', DB))
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
  for (const text of dump) expect(text).not.toMatch(LEAK)
  expect(window.location.href).toBe(before)
  for (const spy of consoles) expect(JSON.stringify(spy.mock.calls)).not.toMatch(LEAK)
})
