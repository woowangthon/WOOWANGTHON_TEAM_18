import { expect, it } from 'vitest'
import { slotsOf, stateText, waitingText } from './metrics.ts'

it('spreads points over 61 one-minute slots and leaves the missing minutes null', () => {
  const end = 10_000
  const slots = slotsOf(
    [
      { t: end - 3600, v: 1 },
      { t: end - 120, v: 5 },
      { t: end, v: 9 },
    ],
    end,
    3600,
    60,
  )
  expect(slots).toHaveLength(61)
  expect(slots[0]).toBe(1)
  expect(slots[58]).toBe(5)
  expect(slots[60]).toBe(9)
  expect(slots.filter((v) => v === null)).toHaveLength(58)
})

it('returns no slots, not a row of nulls, when a service has no points yet', () => {
  expect(slotsOf([], 10_000, 3600, 60)).toEqual([])
})

it('drops a point outside the window instead of stretching the grid', () => {
  const slots = slotsOf([{ t: 1, v: 3 }, { t: 10_000, v: 4 }], 10_000, 3600, 60)
  expect(slots.filter((v) => v !== null)).toEqual([4])
})

it('says each state in plain words and unknown ones as getting ready', () => {
  expect(stateText('running')).toBe('실행 중')
  expect(stateText('starting')).toBe('시작하는 중')
  expect(stateText('stopped')).toBe('꺼져 있어요')
  expect(stateText('whatever')).toBe('준비 중이에요')
})

it('explains the known waiting reasons and falls back to getting ready', () => {
  expect(waitingText('CrashLoopBackOff')).toBe('시작하자마자 계속 꺼지고 있어요')
  expect(waitingText('ImagePullBackOff')).toBe('이미지를 받지 못하고 있어요')
  expect(waitingText('SomethingNew')).toBe('준비 중이에요')
  expect(waitingText(null)).toBe('준비 중이에요')
})

it('ends the grid at the given end time, not at the last point, so a stalled collection leaves the tail empty', () => {
  const end = 10_000
  const slots = slotsOf([{ t: end - 600, v: 7 }], end, 3600, 60)
  expect(slots).toHaveLength(61)
  expect(slots[50]).toBe(7)
  expect(slots.slice(51).every((v) => v === null)).toBe(true)
})
