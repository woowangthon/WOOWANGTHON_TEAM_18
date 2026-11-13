import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import ScreenErrorBoundary from './ScreenErrorBoundary.tsx'

function Broken(): never {
  throw new Error('Failed to fetch dynamically imported module')
}

it('shows a notice with a reload button instead of an empty app when a screen fails to load', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  render(
    <ScreenErrorBoundary>
      <Broken />
    </ScreenErrorBoundary>,
  )
  expect(screen.getByText('화면을 불러오지 못했어요')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '새로고침' }))
  expect(reload).toHaveBeenCalledTimes(1)
  vi.unstubAllGlobals()
  log.mockRestore()
})

it('renders its children untouched when nothing fails', () => {
  render(
    <ScreenErrorBoundary>
      <p>ok</p>
    </ScreenErrorBoundary>,
  )
  expect(screen.getByText('ok')).toBeTruthy()
})
