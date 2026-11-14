import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api.ts'
import { WithQuery } from '../test-utils.tsx'
import DiscordSection from './DiscordSection.tsx'

// 실제 BE를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  apiFetch: api.apiFetch,
}))

const PATH = '/api/profile/discord-webhook'
const URL_OK = 'https://discord.com/api/webhooks/123/secret-token-abcd'

beforeEach(() => {
  api.apiFetch.mockReset().mockResolvedValue({ set: false, hint: null })
})

const show = () =>
  render(
    <WithQuery>
      <DiscordSection />
    </WithQuery>,
  )
const input = () => screen.getByLabelText<HTMLInputElement>('Discord 웹후크 주소')
const type = (value: string) => {
  fireEvent.change(input(), { target: { value } })
}
const puts = () => api.apiFetch.mock.calls.filter((c) => c[2] === 'PUT')

it('says what it is for and links the Discord help in a new tab', async () => {
  show()
  expect(await screen.findByText('등록된 웹후크가 없어요')).toBeTruthy()
  expect(screen.getByText('서비스에 문제가 생기면 이 Discord 채널로 알려 드려요.')).toBeTruthy()
  const help = screen.getByRole('link', { name: /Discord 웹후크 만드는 방법/ })
  expect(help.getAttribute('href')).toBe('https://support.discord.com/hc/ko/articles/228383668')
  expect(help.getAttribute('target')).toBe('_blank')
  expect(help.getAttribute('rel')).toContain('noopener')
  expect(api.apiFetch).toHaveBeenCalledWith(PATH)
})

it('shows only the last four characters of a registered webhook, never the address', async () => {
  api.apiFetch.mockResolvedValue({ set: true, hint: 'abcd' })
  show()
  expect(await screen.findByText('…abcd로 끝나는 웹후크가 등록돼 있어요')).toBeTruthy()
  expect(input().value).toBe('')
  expect(screen.getByRole('button', { name: '웹후크 지우기' })).toBeTruthy()
})

it('saves with PUT, empties the field, and shows only the new hint', async () => {
  api.apiFetch.mockImplementation((_path: string, _body?: unknown, method?: string) =>
    Promise.resolve(method === 'PUT' ? { set: true, hint: 'abcd' } : { set: false, hint: null }),
  )
  show()
  await screen.findByText('등록된 웹후크가 없어요')
  type(`  ${URL_OK}  `)
  fireEvent.click(screen.getByRole('button', { name: '웹후크 저장' }))
  expect(await screen.findByText('웹후크를 저장했어요')).toBeTruthy()
  expect(api.apiFetch).toHaveBeenCalledWith(PATH, { url: URL_OK }, 'PUT')
  expect(input().value).toBe('')
  expect(screen.getByText('…abcd로 끝나는 웹후크가 등록돼 있어요')).toBeTruthy()
  expect(document.body.textContent).not.toContain('secret-token')
})

it('keeps the address hidden in the field', async () => {
  show()
  await screen.findByText('등록된 웹후크가 없어요')
  expect(input().type).toBe('password')
})

it('clears with {url: null}', async () => {
  api.apiFetch.mockImplementation((_path: string, _body?: unknown, method?: string) =>
    Promise.resolve(method === 'PUT' ? { set: false, hint: null } : { set: true, hint: 'abcd' }),
  )
  show()
  fireEvent.click(await screen.findByRole('button', { name: '웹후크 지우기' }))
  expect(await screen.findByText('웹후크를 지웠어요')).toBeTruthy()
  expect(api.apiFetch).toHaveBeenCalledWith(PATH, { url: null }, 'PUT')
  expect(screen.getByText('등록된 웹후크가 없어요')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '웹후크 지우기' })).toBeNull()
})

it('says INVALID_WEBHOOK next to the field and keeps what was typed', async () => {
  api.apiFetch.mockImplementation((_path: string, _body?: unknown, method?: string) =>
    method === 'PUT' ? Promise.reject(new ApiError(400, 'INVALID_WEBHOOK', 'x')) : Promise.resolve({ set: false, hint: null }),
  )
  show()
  await screen.findByText('등록된 웹후크가 없어요')
  type('https://example.com/hook')
  fireEvent.click(screen.getByRole('button', { name: '웹후크 저장' }))
  expect((await screen.findByRole('alert')).textContent).toContain('https://discord.com/api/webhooks/로 시작해야 해요')
  expect(input().value).toBe('https://example.com/hook')
})

it('does not send an empty address', async () => {
  show()
  await screen.findByText('등록된 웹후크가 없어요')
  fireEvent.click(screen.getByRole('button', { name: '웹후크 저장' }))
  expect(screen.getByText('웹후크 주소를 입력해 주세요')).toBeTruthy()
  expect(puts()).toHaveLength(0)
})

it('says saving failed, not the user fault, for any other error', async () => {
  api.apiFetch.mockImplementation((_path: string, _body?: unknown, method?: string) =>
    method === 'PUT' ? Promise.reject(new ApiError(503, 'DATABASE_UNAVAILABLE', 'x')) : Promise.resolve({ set: true, hint: 'abcd' }),
  )
  show()
  await screen.findByText('…abcd로 끝나는 웹후크가 등록돼 있어요')
  type(URL_OK)
  fireEvent.click(screen.getByRole('button', { name: '웹후크 바꾸기' }))
  expect(await screen.findByText('웹후크를 저장하지 못했어요')).toBeTruthy()
  // 지난 등록은 그대로다.
  expect(screen.getByText('…abcd로 끝나는 웹후크가 등록돼 있어요')).toBeTruthy()
})

it('still lets the user register when the current state cannot be read', async () => {
  api.apiFetch.mockRejectedValue(new ApiError(503, 'DATABASE_UNAVAILABLE', 'x'))
  show()
  expect(await screen.findByText('등록 상태를 읽지 못했어요')).toBeTruthy()
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '웹후크 저장' })).toBeTruthy()
  })
})
