import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Sparkline } from './Sparkline.tsx'

const NOT_COLLECTED = '아직 수집하지 못했어요'

const paths = (container: HTMLElement) => Array.from(container.querySelectorAll('path'))
const pct = (n: number) => `${n}%`

it('says it could not collect and draws nothing for an empty list', () => {
  const { container } = render(<Sparkline emptyText={NOT_COLLECTED} values={[]} label="CPU 사용량" />)
  expect(screen.getByText(`CPU 사용량: ${NOT_COLLECTED}`)).toBeTruthy()
  expect(container.querySelector('svg')).toBeNull()
})

it('does not draw a fake line when every value is null', () => {
  const { container } = render(<Sparkline emptyText={NOT_COLLECTED} values={[null, null, null]} label="메모리" />)
  expect(screen.getByText(`메모리: ${NOT_COLLECTED}`)).toBeTruthy()
  expect(container.querySelector('svg')).toBeNull()
})

it('draws one dot and states min, max and now as the same value for a single value', () => {
  const { container } = render(<Sparkline emptyText={NOT_COLLECTED} values={[40]} label="CPU 사용량" format={pct} />)
  expect(paths(container)).toHaveLength(1)
  expect(paths(container)[0].getAttribute('d')).toMatch(/h0$/)
  expect(screen.getByRole('img').getAttribute('aria-label')).toBe('CPU 사용량: 최저 40% · 최고 40% · 지금 40%')
})

it('puts min, max and the latest value in the accessible summary and in visible text', () => {
  render(<Sparkline emptyText={NOT_COLLECTED} values={[10, 30, 20]} label="CPU 사용량" format={pct} />)
  const summary = '최저 10% · 최고 30% · 지금 20%'
  expect(screen.getByRole('img').getAttribute('aria-label')).toBe(`CPU 사용량: ${summary}`)
  expect(screen.getByText(summary)).toBeTruthy()
})

it('breaks the line at a null instead of joining the points around it', () => {
  const { container } = render(<Sparkline emptyText={NOT_COLLECTED} values={[10, 20, null, 30, 40]} label="CPU 사용량" />)
  const lines = paths(container)
  expect(lines).toHaveLength(2)
  for (const line of lines) expect(line.getAttribute('d')).not.toMatch(/h0$/)
})

it('draws a dot for a lone point between two nulls', () => {
  const { container } = render(<Sparkline emptyText={NOT_COLLECTED} values={[null, 5, null, 8, 9]} label="메모리" />)
  const d = paths(container).map((p) => p.getAttribute('d') ?? '')
  expect(d).toHaveLength(2)
  expect(d[0]).toMatch(/h0$/)
})

it('does not claim a current value when the newest value is null', () => {
  render(<Sparkline emptyText={NOT_COLLECTED} values={[10, 20, null]} label="CPU 사용량" format={pct} />)
  expect(screen.getByRole('img').getAttribute('aria-label')).toBe(`CPU 사용량: 최저 10% · 최고 20% · 지금 ${NOT_COLLECTED}`)
})

it('keeps every point inside the box, with the max at the top and the min at the bottom', () => {
  const { container } = render(<Sparkline emptyText={NOT_COLLECTED} values={[0, 100, 50]} label="x" />)
  const d = paths(container)[0].getAttribute('d') ?? ''
  const ys = Array.from(d.matchAll(/ (\d+(?:\.\d+)?)/g)).map((m) => Number(m[1]))
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
  expect(Math.max(...ys)).toBeLessThanOrEqual(32)
  expect(ys[0]).toBeGreaterThan(ys[1])
})

it('draws a flat series at mid height instead of dividing by zero', () => {
  const { container } = render(<Sparkline emptyText={NOT_COLLECTED} values={[7, 7, 7]} label="x" />)
  const d = paths(container)[0].getAttribute('d') ?? ''
  expect(d).not.toContain('NaN')
  expect(d).not.toContain('Infinity')
})
