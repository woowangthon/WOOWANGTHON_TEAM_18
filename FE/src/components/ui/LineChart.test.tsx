import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { LineChart } from './LineChart.tsx'

const NOT_COLLECTED = '아직 수집하지 못했어요'

const paths = (container: HTMLElement) => Array.from(container.querySelectorAll('path'))
const pct = (n: number) => `${n}%`
const ys = (d: string) => Array.from(d.matchAll(/ (\d+(?:\.\d+)?)/g)).map((m) => Number(m[1]))

it('says it could not collect and draws nothing for an empty list', () => {
  const { container } = render(<LineChart emptyText={NOT_COLLECTED} values={[]} label="CPU 사용량" />)
  expect(screen.getByText(`CPU 사용량: ${NOT_COLLECTED}`)).toBeTruthy()
  expect(container.querySelector('svg')).toBeNull()
})

it('does not draw a fake line when every value is null', () => {
  const { container } = render(<LineChart emptyText={NOT_COLLECTED} values={[null, null, null]} label="메모리" />)
  expect(screen.getByText(`메모리: ${NOT_COLLECTED}`)).toBeTruthy()
  expect(container.querySelector('svg')).toBeNull()
})

it('draws one dot and states min, max and now as the same value for a single value', () => {
  const { container } = render(<LineChart emptyText={NOT_COLLECTED} values={[40]} label="CPU 사용량" format={pct} />)
  expect(paths(container)).toHaveLength(1)
  expect(paths(container)[0].getAttribute('d')).toMatch(/h0$/)
  expect(screen.getByRole('img').getAttribute('aria-label')).toBe('CPU 사용량: 최저 40% · 최고 40% · 지금 40%')
})

it('puts min, max and the latest value in the accessible summary and in visible text', () => {
  render(<LineChart emptyText={NOT_COLLECTED} values={[10, 30, 20]} label="CPU 사용량" format={pct} />)
  const summary = '최저 10% · 최고 30% · 지금 20%'
  expect(screen.getByRole('img').getAttribute('aria-label')).toBe(`CPU 사용량: ${summary}`)
  expect(screen.getByText(summary)).toBeTruthy()
})

it('breaks the line at a null instead of joining the points around it', () => {
  const { container } = render(<LineChart emptyText={NOT_COLLECTED} values={[10, 20, null, 30, 40]} label="CPU 사용량" />)
  const lines = paths(container)
  expect(lines).toHaveLength(2)
  for (const line of lines) expect(line.getAttribute('d')).not.toMatch(/h0$/)
})

it('draws a dot for a lone point between two nulls', () => {
  const { container } = render(<LineChart emptyText={NOT_COLLECTED} values={[null, 5, null, 8, 9]} label="메모리" />)
  const d = paths(container).map((p) => p.getAttribute('d') ?? '')
  expect(d).toHaveLength(2)
  expect(d[0]).toMatch(/h0$/)
})

it('does not claim a current value when the newest value is null', () => {
  render(<LineChart emptyText={NOT_COLLECTED} values={[10, 20, null]} label="CPU 사용량" format={pct} />)
  expect(screen.getByRole('img').getAttribute('aria-label')).toBe(`CPU 사용량: 최저 10% · 최고 20% · 지금 ${NOT_COLLECTED}`)
})

it('keeps every point inside the box and starts the value axis at zero, so the minimum is above the floor', () => {
  const { container } = render(<LineChart emptyText={NOT_COLLECTED} values={[20, 100, 50]} label="x" />)
  const y = ys(paths(container)[0].getAttribute('d') ?? '')
  expect(Math.min(...y)).toBeGreaterThanOrEqual(0)
  expect(Math.max(...y)).toBeLessThanOrEqual(100)
  // 최댓값이 위쪽 끝 눈금(100)이면 맨 위, 20은 바닥(100)에서 20만큼 위.
  expect(y[1]).toBe(0)
  expect(y[0]).toBe(80)
})

it('draws a flat series without dividing by zero', () => {
  const { container } = render(<LineChart emptyText={NOT_COLLECTED} values={[7, 7, 7]} label="x" />)
  const d = paths(container)[0].getAttribute('d') ?? ''
  expect(d).not.toContain('NaN')
  expect(d).not.toContain('Infinity')
})

it('labels the value axis with units at zero, half and the rounded top', () => {
  render(<LineChart emptyText={NOT_COLLECTED} values={[20, 73, 50]} label="x" format={(v) => `${v}MiB`} />)
  const axis = document.querySelector('.w-16') as HTMLElement
  expect([...axis.querySelectorAll('span')].map((s) => s.textContent)).toEqual(['0MiB', '50MiB', '100MiB'])
})

it('draws grid lines at the axis marks and a time axis only when it knows the times', () => {
  const { container, rerender } = render(<LineChart emptyText={NOT_COLLECTED} values={[1, 2, 3, 4, 5, 6, 7]} label="x" />)
  expect(container.querySelectorAll('line')).toHaveLength(2)
  expect(container.querySelector('.h-4')).toBeNull()
  rerender(<LineChart emptyText={NOT_COLLECTED} values={[1, 2, 3, 4, 5, 6, 7]} label="x" xAt={(i) => `t${i}`} />)
  expect([...(container.querySelector('.h-4') as HTMLElement).querySelectorAll('span')].map((s) => s.textContent)).toEqual(['t0', 't3', 't6'])
})

it('draws a dashed reference line with its label and makes room for it on the value axis', () => {
  const { container } = render(<LineChart emptyText={NOT_COLLECTED} values={[10, 20]} label="x" format={pct} reference={{ value: 80, label: '한도' }} />)
  expect(screen.getByText('한도 80%')).toBeTruthy()
  expect(container.querySelector('line[stroke-dasharray]')).toBeTruthy()
  // 위쪽 끝 눈금이 한도(80)를 넘겨 100이다.
  expect([...(document.querySelector('.w-16') as HTMLElement).querySelectorAll('span')].map((s) => s.textContent)).toContain('100%')
})

it('draws no reference line when none is given', () => {
  const { container } = render(<LineChart emptyText={NOT_COLLECTED} values={[10, 20]} label="x" />)
  expect(container.querySelector('line[stroke-dasharray]')).toBeNull()
})

it('shows the time and value of the nearest point in a tooltip while the pointer is over the plot', () => {
  const { container } = render(<LineChart emptyText={NOT_COLLECTED} values={[10, 20, 30]} label="x" format={pct} xAt={(i) => `t${i}`} />)
  const plot = container.querySelector('.h-40.border-b') as HTMLElement
  plot.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 160, right: 200, bottom: 160, x: 0, y: 0, toJSON: () => ({}) })
  expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
  fireEvent.pointerMove(plot, { clientX: 105 })
  expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe('t1 · 20%')
  fireEvent.pointerMove(plot, { clientX: 190 })
  expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe('t2 · 30%')
  fireEvent.pointerLeave(plot)
  expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
})

it('moves to the nearest point that has a value when the pointer is over a gap', () => {
  const { container } = render(<LineChart emptyText={NOT_COLLECTED} values={[10, null, null, null, 50]} label="x" format={pct} />)
  const plot = container.querySelector('.h-40.border-b') as HTMLElement
  plot.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 160, right: 400, bottom: 160, x: 0, y: 0, toJSON: () => ({}) })
  fireEvent.pointerMove(plot, { clientX: 150 })
  expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe('10%')
})

it('writes each time label once when there are only two points', () => {
  render(<LineChart emptyText={NOT_COLLECTED} values={[1, 2]} label="CPU 사용량" xAt={(i) => `t${i}`} />)
  expect(screen.getAllByText('t0')).toHaveLength(1)
  expect(screen.getAllByText('t1')).toHaveLength(1)
})
