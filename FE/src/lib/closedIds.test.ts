import { afterEach, describe, expect, it } from 'vitest'
import { addClosed, removeClosed } from './closedIds.ts'

const KEY = 'test.closed'
const xs = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `x${from + i}`)

afterEach(() => {
  localStorage.clear()
})

describe('closedIds', () => {
  it('keeps the newest ids when another tab added one after this screen read the list', () => {
    const current = xs(0, 100) // 이 화면이 처음 읽은 목록
    localStorage.setItem(KEY, JSON.stringify([...xs(1, 100), 'b'])) // 그 뒤 다른 탭이 b를 숨겨 x0이 밀려났다
    const next = addClosed(KEY, current, 'a')
    expect(next).toEqual([...xs(2, 100), 'b', 'a'])
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual(next)
  })

  it('removes one id and keeps what another tab saved', () => {
    localStorage.setItem(KEY, JSON.stringify(['a', 'b', 'c']))
    expect(removeClosed(KEY, ['a'], 'b')).toEqual(['a', 'c'])
  })
})
