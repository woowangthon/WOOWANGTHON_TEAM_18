import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import App from './App.tsx'

it('renders without crashing (App draws nothing until the first screen exists)', () => {
  const { container } = render(<App />)
  expect(container.firstChild).toBeNull()
})
