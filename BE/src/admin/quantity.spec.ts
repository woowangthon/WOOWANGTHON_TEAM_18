import { describe, expect, it } from 'vitest'
import { bytes, millicores } from './quantity.js'

describe('millicores', () => {
  it.each([
    ['4', 4000],
    ['3800m', 3800],
    ['0.5', 500],
    ['250000000n', 250],
    ['2k', 2_000_000],
  ])('%s is %d', (q, expected) => expect(millicores(q)).toBe(expected))
})

describe('bytes', () => {
  it.each([
    ['123456', 123456],
    ['16Gi', 16 * 2 ** 30],
    ['123456Ki', 123456 * 1024],
    ['1Mi', 1048576],
    ['500M', 500_000_000],
    ['1.5Gi', 1.5 * 2 ** 30],
    ['2Ti', 2 * 2 ** 40],
  ])('%s is %d', (q, expected) => expect(bytes(q)).toBe(expected))
})

describe('an unreadable quantity', () => {
  it.each([undefined, null, 5, '', 'abc', '12x', '-1', '1e3', '1 Gi', '1Gib'])('is null: %s', (q) => {
    expect(millicores(q)).toBeNull()
    expect(bytes(q)).toBeNull()
  })
})
