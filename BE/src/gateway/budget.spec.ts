import { describe, expect, it } from 'vitest'
import { ToolBudget } from './budget.js'

// 명세(AIagent.md §3 "전체 제한")의 숫자. 구현의 상수를 가져다 쓰면 상수가 바뀌어도 테스트가 따라 바뀐다.
const SPEC_CALLS = 20
const SPEC_WORK_MS = 15 * 60_000

describe('ToolBudget', () => {
  it('allows the same call twice in a row, blocks the third, and the same arguments in another key order count as the same', () => {
    const budget = new ToolBudget()
    expect(budget.take('t', 'read_pod_logs', { service: 'be', lines: 5 })).toBeNull()
    expect(budget.take('t', 'read_pod_logs', { lines: 5, service: 'be' })).toBeNull()
    expect(budget.take('t', 'read_pod_logs', { service: 'be', lines: 5 })).toBe('REPEATED_CALL')
    // 다른 호출이 끼면 다시 센다.
    expect(budget.take('t', 'read_repo', { path: '.' })).toBeNull()
    expect(budget.take('t', 'read_pod_logs', { service: 'be', lines: 5 })).toBeNull()
  })

  it('stops at the total without counting blocked calls, per ticket', () => {
    const budget = new ToolBudget()
    expect(budget.take('t', 'read_repo', { path: '0' })).toBeNull()
    expect(budget.take('t', 'read_repo', { path: '0' })).toBeNull()
    expect(budget.take('t', 'read_repo', { path: '0' })).toBe('REPEATED_CALL')
    for (let i = 2; i < SPEC_CALLS; i++) expect(budget.take('t', 'read_repo', { path: String(i) })).toBeNull()
    expect(budget.take('t', 'read_repo', { path: 'x' })).toBe('TOOL_LIMIT')
    expect(budget.take('other', 'read_repo', { path: 'x' })).toBeNull()
  })

  it('stops after the working time from the first call, and forget starts over', () => {
    let now = 1_000
    const budget = new ToolBudget(() => now)
    expect(budget.take('t', 'read_repo', { path: '.' })).toBeNull()
    now += SPEC_WORK_MS
    expect(budget.take('t', 'read_repo', { path: 'a' })).toBeNull()
    now += 1
    expect(budget.take('t', 'read_repo', { path: 'b' })).toBe('TIME_LIMIT')
    budget.forget('t')
    expect(budget.take('t', 'read_repo', { path: 'b' })).toBeNull()
  })
})
