import { describe, expect, it } from 'vitest'
import { domainFromEnv, parseSlot } from './render.js'

describe('render CLI settings', () => {
  it('reads the public domain', () => {
    expect(domainFromEnv({ BASE_DOMAIN: 'stairnoworks.com' })).toBe('stairnoworks.com')
  })

  it.each([undefined, '', 'https://stairnoworks.com', 'stairnoworks', '-x.com', 'X.com'])('refuses BASE_DOMAIN %s', (v) => {
    expect(() => domainFromEnv({ BASE_DOMAIN: v })).toThrow('BASE_DOMAIN must look like stairnoworks.com')
  })

  it('takes slot a or b only', () => {
    expect(parseSlot('a')).toBe('a')
    expect(parseSlot('b')).toBe('b')
    for (const v of ['A', 'c', '', undefined]) expect(() => parseSlot(v)).toThrow('slot must be a or b')
  })
})
