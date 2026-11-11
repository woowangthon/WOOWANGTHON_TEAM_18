import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import CommitRef from './CommitRef.tsx'
import { COMMIT } from './fixtures.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

const withClipboard = (writeText: () => Promise<void>) => {
  const spy = vi.fn(writeText)
  vi.stubGlobal('navigator', { clipboard: { writeText: spy } })
  return spy
}

it('shows 7 characters and copies the full SHA', async () => {
  const write = withClipboard(() => Promise.resolve())
  render(<CommitRef commit={COMMIT} />)
  expect(screen.getByText(COMMIT.slice(0, 7)).getAttribute('title')).toBe(COMMIT)
  expect(screen.queryByText(COMMIT)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'commit 전체 해시 복사' }))
  expect(await screen.findByText('복사했어요')).toBeTruthy()
  expect(write).toHaveBeenCalledWith(COMMIT)
})

it('shows the full SHA when the browser refuses to copy', async () => {
  withClipboard(() => Promise.reject(new Error('denied')))
  render(<CommitRef commit={COMMIT} />)
  fireEvent.click(screen.getByRole('button', { name: 'commit 전체 해시 복사' }))
  expect(await screen.findByText(COMMIT)).toBeTruthy()
  expect(screen.getByText(/복사하지 못했어요/)).toBeTruthy()
})
