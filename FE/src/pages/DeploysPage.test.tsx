import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import type { DeployListItem } from '../deploy/progress.ts'
import { ApiError } from '../lib/api.ts'
import DeploysPage from './DeploysPage.tsx'

// 실제 BE를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  apiFetch: api.apiFetch,
}))

const item = (id: string, slug: string, status: DeployListItem['status']): DeployListItem => ({
  id,
  repo: `student/${slug}`,
  slug,
  commit: '0123456789abcdef0123456789abcdef01234567',
  createdAt: '2026-11-11T01:00:00.000Z',
  status,
  stage: null,
  url: null,
})

beforeEach(() => {
  api.apiFetch.mockReset()
})

const show = () =>
  render(
    <MemoryRouter>
      <DeploysPage />
    </MemoryRouter>,
  )
const row = (slug: string) => screen.getAllByRole('row').find((r) => r.textContent.includes(slug))

it('lists my deploys in the order the server gave, each with its state in words and a link to its progress screen', async () => {
  api.apiFetch.mockResolvedValue({ deploys: [item('id-b', 'newer-app', 'running'), item('id-a', 'older-app', 'succeeded')] })
  show()
  await screen.findByRole('region', { name: '내 배포 목록' })
  expect(api.apiFetch).toHaveBeenCalledWith('/api/deploys')
  const rows = screen.getAllByRole('row').slice(1)
  expect(rows.map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual(['newer-app', 'older-app'])
  expect(within(row('newer-app') as HTMLElement).getByText('진행 중')).toBeTruthy()
  expect(within(row('older-app') as HTMLElement).getByText('완료')).toBeTruthy()
  expect(within(row('newer-app') as HTMLElement).getByRole('link', { name: /보기/ }).getAttribute('href')).toBe('/deploys/id-b')
})

it('says there is nothing yet and points to a new request when the list is empty', async () => {
  api.apiFetch.mockResolvedValue({ deploys: [] })
  show()
  expect(await screen.findByText(/아직 배포가 없어요/)).toBeTruthy()
  expect(screen.getByRole('link', { name: '새 배포 요청하기' }).getAttribute('href')).toBe('/deploy/new')
})

it('does not turn a failed read into "no deploys", and reads again on retry', async () => {
  api.apiFetch.mockRejectedValueOnce(new ApiError(503, 'DATABASE_UNAVAILABLE', 'x')).mockResolvedValue({ deploys: [item('id-a', 'my-app', 'failed')] })
  show()
  expect(await screen.findByText('배포 목록을 불러오지 못했어요')).toBeTruthy()
  expect(screen.queryByText(/아직 배포가 없어요/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await waitFor(() => {
    expect(within(row('my-app') as HTMLElement).getByText('실패')).toBeTruthy()
  })
  expect(api.apiFetch).toHaveBeenCalledTimes(2)
})
