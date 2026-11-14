import { describe, expect, it } from 'vitest'
import { lineDiff } from './line-diff.js'

const lines = (n: number, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i}`).join('\n')

describe('lineDiff', () => {
  it('finds nothing in equal text', () => {
    expect(lineDiff('a\nb\nc', 'a\nb\nc', 50)).toEqual({ added: [], removed: [] })
    expect(lineDiff('', '', 50)).toEqual({ added: [], removed: [] })
  })

  it('counts a changed line as one removed and one added', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc', 50)).toEqual({ added: ['B'], removed: ['b'] })
  })

  it('reads inserted and deleted lines in order', () => {
    expect(lineDiff('a\nb\nc\nd', 'a\nx\nb\nd\ny', 50)).toEqual({ added: ['x', 'y'], removed: ['c'] })
    expect(lineDiff('a', 'a\nb\nc', 50)).toEqual({ added: ['b', 'c'], removed: [] })
  })

  it('does not count the end of the last line as an empty line', () => {
    expect(lineDiff('', 'a\nb\n', 50)).toEqual({ added: ['a', 'b'], removed: [] })
    expect(lineDiff('a\n', 'a\nb\n', 50)).toEqual({ added: ['b'], removed: [] })
    // 끝 줄바꿈만 다른 글은 줄이 모두 같다(바뀐 줄 0).
    expect(lineDiff('a', 'a\n', 50)).toEqual({ added: [], removed: [] })
  })

  it('treats a new file as all added and an emptied file as all removed', () => {
    expect(lineDiff('', 'a\nb', 50)).toEqual({ added: ['a', 'b'], removed: [] })
    expect(lineDiff('a\nb', '', 50)).toEqual({ added: [], removed: ['a', 'b'] })
  })

  it('finds two far apart edits in a long file without counting the lines between', () => {
    const before = lines(5000)
    const after = before.replace('line 10\n', 'ten\n').replace('line 4000\n', 'four thousand\n')
    const diff = lineDiff(before, after, 50)
    expect(diff).toEqual({ added: ['ten', 'four thousand'], removed: ['line 10', 'line 4000'] })
  })

  it('allows exactly the limit and refuses one more', () => {
    expect(lineDiff('', lines(50), 50)?.added).toHaveLength(50)
    expect(lineDiff('', lines(51), 50)).toBeNull()
    // 25 lines changed = 50 changed lines (a change counts twice).
    expect(lineDiff(lines(25), lines(25, 'new'), 50)).not.toBeNull()
    expect(lineDiff(lines(26), lines(26, 'new'), 50)).toBeNull()
  })

  it('treats a changed line ending as every line changed', () => {
    expect(lineDiff(lines(30), lines(30).replaceAll('\n', '\r\n'), 50)).toBeNull()
  })
})
