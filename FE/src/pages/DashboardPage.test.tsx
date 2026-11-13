import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import type { DeployListItem } from '../deploy/progress.ts'
import DashboardPage from './DashboardPage.tsx'

// 실제 BE · Supabase를 부르지 않는다. 테스트 전용 대역이라 MOCK 표식은 필요 없다(conventions §6).
const auth = vi.hoisted(() => ({ getUserIdentities: vi.fn() }))
vi.mock('../lib/supabase.ts', () => ({ supabase: { auth } }))
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  apiFetch: api.apiFetch,
}))

const run = (
  id: string,
  slug: string,
  status: DeployListItem['status'],
  createdAt: string,
  url: string | null = null,
): DeployListItem => ({ id, slug, repo: `me/${slug}`, commit: 'c', createdAt, status, stage: null, url })

beforeEach(() => {
  api.apiFetch.mockReset()
  auth.getUserIdentities.mockReset().mockResolvedValue({
    data: { identities: [{ provider: 'github', identity_data: { user_name: 'me' } }] },
    error: null,
  })
})

const show = () =>
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  )
const tile = (label: string) =>
  [...document.querySelectorAll('dt')].find((dt) => dt.textContent === label)?.parentElement?.textContent

it('groups runs by project and shows the latest run of each, with its URL and a link to its progress', async () => {
  api.apiFetch.mockResolvedValue({
    deploys: [
      run('new', 'shop', 'succeeded', '2026-11-13T10:00:00Z', 'https://shop.example.com'),
      run('old', 'shop', 'failed', '2026-11-12T10:00:00Z'),
      run('only', 'blog', 'running', '2026-11-11T10:00:00Z'),
    ],
  })
  show()
  const list = await screen.findByRole('list')
  const items = within(list).getAllByRole('listitem')
  expect(items).toHaveLength(2)
  const shop = items[0]
  expect(shop.textContent).toContain('shop')
  expect(within(shop).getByText('완료')).toBeTruthy()
  const url = within(shop).getByRole('link', { name: /shop\.example\.com/ })
  expect(url.getAttribute('href')).toBe('https://shop.example.com')
  expect(url.getAttribute('target')).toBe('_blank')
  expect(url.getAttribute('rel')).toContain('noopener')
  expect(within(shop).getByRole('link', { name: /자세히/ }).getAttribute('href')).toBe('/deploys/new')
  expect(within(items[1]).getByText('진행 중')).toBeTruthy()
})

it('counts the tiles from the latest run of each project only', async () => {
  api.apiFetch.mockResolvedValue({
    deploys: [
      run('1', 'a', 'succeeded', '2026-11-13T10:00:00Z'),
      run('2', 'a', 'failed', '2026-11-12T10:00:00Z'),
      run('3', 'b', 'running', '2026-11-13T09:00:00Z'),
      run('4', 'c', 'fixing', '2026-11-13T08:00:00Z'),
      run('5', 'd', 'failed', '2026-11-13T07:00:00Z'),
      run('6', 'e', 'needs_user', '2026-11-13T06:00:00Z'),
      run('7', 'f', 'not_started', '2026-11-13T05:00:00Z'),
    ],
  })
  show()
  await screen.findByRole('list')
  expect(tile('전체 프로젝트')).toBe('전체 프로젝트6')
  expect(tile('실행 중')).toBe('실행 중1')
  expect(tile('진행 중')).toBe('진행 중2')
  expect(tile('확인 필요')).toBe('확인 필요2')
})

it('does not link an address that is not http(s)', async () => {
  api.apiFetch.mockResolvedValue({ deploys: [run('1', 'x', 'succeeded', '2026-11-13T10:00:00Z', 'javascript:alert(1)')] })
  show()
  await screen.findByRole('list')
  expect(screen.queryByRole('link', { name: /javascript/ })).toBeNull()
})

it('keeps the primary action to request a new deploy', async () => {
  api.apiFetch.mockResolvedValue({ deploys: [] })
  show()
  expect(screen.getAllByRole('link', { name: /새 배포 요청/ })[0]?.getAttribute('href')).toBe('/deploy/new')
  await screen.findByText('아직 배포가 없어요.')
})

it('shows a loading state, then an empty state with no tiles when there are no deploys', async () => {
  api.apiFetch.mockResolvedValue({ deploys: [] })
  show()
  expect(screen.getByText('불러오는 중…')).toBeTruthy()
  expect(await screen.findByText('아직 배포가 없어요.')).toBeTruthy()
  expect(screen.queryByText('전체 프로젝트')).toBeNull()
})

it('says the list failed to load (not "no deploys") and retries', async () => {
  api.apiFetch.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ deploys: [run('1', 'a', 'succeeded', '2026-11-13T10:00:00Z')] })
  show()
  expect(await screen.findByText('배포 목록을 불러오지 못했어요')).toBeTruthy()
  expect(screen.queryByText('아직 배포가 없어요.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByRole('list')).toBeTruthy()
})

it('shows a GitHub-not-linked notice linking to the profile only when the account is not linked', async () => {
  auth.getUserIdentities.mockResolvedValue({ data: { identities: [{ provider: 'email' }] }, error: null })
  api.apiFetch.mockResolvedValue({ deploys: [] })
  show()
  const link = await screen.findByRole('link', { name: '프로필에서 연동하기' })
  expect(link.getAttribute('href')).toBe('/profile')
  expect(screen.getByText('GitHub 미연동')).toBeTruthy()
})

it('shows no GitHub notice when linked or when the link state cannot be read', async () => {
  api.apiFetch.mockResolvedValue({ deploys: [] })
  show()
  await screen.findByText('아직 배포가 없어요.')
  expect(screen.queryByText('GitHub 미연동')).toBeNull()
  auth.getUserIdentities.mockResolvedValue({ data: null, error: new Error('x') })
  show()
  await waitFor(() => {
    expect(screen.getAllByText('아직 배포가 없어요.').length).toBe(2)
  })
  expect(screen.queryByText('GitHub 미연동')).toBeNull()
})
