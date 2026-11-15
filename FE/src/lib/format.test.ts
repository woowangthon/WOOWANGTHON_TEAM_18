import { expect, it } from 'vitest'
import { cpuText, memoryText } from './format.ts'

it('shows a small non-zero CPU figure in whole millicores so axis ticks below 0.01 core differ', () => {
  expect(cpuText(40)).toBe('0.04코어')
  expect(cpuText(25)).toBe('0.025코어')
  expect(cpuText(99)).toBe('0.099코어')
  expect(cpuText(2)).toBe('0.002코어')
  expect(cpuText(4)).toBe('0.004코어')
  expect(cpuText(2)).not.toBe(cpuText(4))
})

it('says "미만" for a non-zero figure under one millicore', () => {
  expect(cpuText(0.4)).toBe('0.001코어 미만')
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
