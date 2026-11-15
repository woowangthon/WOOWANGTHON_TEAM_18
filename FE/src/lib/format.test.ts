import { expect, it } from 'vitest'
import { cpuText, memoryText } from './format.ts'

it('shows a small non-zero CPU figure in whole millicores so axis ticks below 0.01 core differ', () => {
  expect(cpuText(40)).toBe('0.04코어')
  expect(cpuText(25)).toBe('0.025코어')
  expect(cpuText(99.4)).toBe('0.099코어')
  expect(cpuText(2)).toBe('0.002코어')
  expect(cpuText(4)).toBe('0.004코어')
  expect(cpuText(2)).not.toBe(cpuText(4))
})

it('keeps two significant digits below one millicore too, with no "미만"', () => {
  expect(cpuText(0.5)).toBe('0.0005코어')
  expect(cpuText(1.5)).toBe('0.0015코어')
  expect(cpuText(99.9)).toBe('0.1코어')
})

it('gives every axis tick a different label when the top is 2m or 0.5m (the chart draws 0, top/2 and top)', () => {
  for (const top of [2, 0.5]) {
    const labels = [0, 1, 2].map((r) => cpuText((top * r) / 2))
    expect(new Set(labels).size).toBe(3)
  }
  for (const top of [2, 0.5]) {
    const labels = [1, 2, 3, 4].map((r) => cpuText((top * r) / 4))
    expect(new Set(labels).size).toBe(4)
  }
})

it('keeps exactly 0, 0.1 cores and above, and unreadable values as before', () => {
  expect(cpuText(0)).toBe('0코어')
  expect(cpuText(100)).toBe('0.1코어')
  expect(cpuText(500)).toBe('0.5코어')
  expect(cpuText(3900)).toBe('3.9코어')
  expect(cpuText(24000)).toBe('24코어')
  expect(cpuText(null)).toBe('읽지 못함')
})

it('shows a service memory in MiB', () => {
  expect(memoryText(73_400_320)).toBe('70MiB')
})
