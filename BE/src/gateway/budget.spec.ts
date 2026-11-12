import { describe, expect, it } from 'vitest'
import { ToolBudget } from './budget.js'

// 명세(AIagent.md §3 "전체 제한", api.md "파이프라인 ↔ 플랫폼 서버" 4번 "시간")의 숫자. 구현의 상수를 가져다 쓰면 상수가 바뀌어도 테스트가 따라 바뀐다.
const SPEC_CALLS = 20
const SPEC_WORK_MS = 15 * 60_000
const SPEC_TICKET_MS = 60 * 60_000
const SPEC_TRIAL_MS = 30 * 60_000
const MIN = 60_000

describe('ToolBudget', () => {
  it('allows the same call twice in a row, blocks the third, and the same arguments in another key order count as the same', () => {
    const budget = new ToolBudget(() => 0)
    expect(budget.take('t', 'read_pod_logs', { service: 'be', lines: 5 }, 0)).toBeNull()
    expect(budget.take('t', 'read_pod_logs', { lines: 5, service: 'be' }, 0)).toBeNull()
    expect(budget.take('t', 'read_pod_logs', { service: 'be', lines: 5 }, 0)).toBe('REPEATED_CALL')
    // 다른 호출이 끼면 다시 센다.
    expect(budget.take('t', 'read_repo', { path: '.' }, 0)).toBeNull()
    expect(budget.take('t', 'read_pod_logs', { service: 'be', lines: 5 }, 0)).toBeNull()
  })

  it('stops at the total without counting blocked calls, per ticket', () => {
    let now = 1_000
    const budget = new ToolBudget(() => now)
    expect(budget.take('t', 'read_repo', { path: '0' }, now)).toBeNull()
    expect(budget.take('t', 'read_repo', { path: '0' }, now)).toBeNull()
    expect(budget.take('t', 'read_repo', { path: '0' }, now)).toBe('REPEATED_CALL')
    for (let i = 2; i < SPEC_CALLS; i++) expect(budget.take('t', 'read_repo', { path: String(i) }, now)).toBeNull()
    expect(budget.take('t', 'read_repo', { path: 'x' }, now)).toBe('TOOL_LIMIT')
    now += 1
    expect(budget.take('other', 'read_repo', { path: 'x' }, now)).toBeNull()
  })

  it('counts the trial tools per ticket (build 2, render 5, deploy 2, verify 3)', () => {
    const budget = new ToolBudget(() => 0)
    for (const [tool, limit] of [['run_build', 2], ['run_render', 5], ['run_deploy', 2], ['run_verify', 3]] as const) {
      for (let i = 0; i < limit; i++) expect(budget.take('t', tool, { i }, 0)).toBeNull()
      expect(budget.take('t', tool, { i: 'x' }, 0)).toBe('TOOL_LIMIT')
    }
  })

  it('stops after the working time from the first call, and forget starts over', () => {
    let now = 1_000
    const budget = new ToolBudget(() => now)
    expect(budget.take('t', 'read_repo', { path: '.' }, now)).toBeNull()
    now += SPEC_WORK_MS
    expect(budget.take('t', 'read_repo', { path: 'a' }, now)).toBeNull()
    now += 1
    expect(budget.take('t', 'read_repo', { path: 'b' }, now)).toBe('TIME_LIMIT')
    budget.forget('t')
    expect(budget.take('t', 'read_repo', { path: 'b' }, now)).toBeNull()
  })

  it('leaves trial waits out of the working time but not out of the 60-minute ticket cap', () => {
    let now = 0
    const budget = new ToolBudget(() => now)
    expect(budget.take('t', 'run_deploy', {}, 0)).toBeNull()
    // 대기 상한은 30분, 티켓 상한까지 남은 시간이 짧으면 그쪽.
    expect(budget.waitCap('t', SPEC_TRIAL_MS)).toBe(SPEC_TRIAL_MS)
    // 대기를 시작할 때 토큰 만료: 지금 + 남은 작업 15분 + 이번 대기 상한.
    now = 5 * MIN
    expect(budget.startWait('t', SPEC_TRIAL_MS)).toBe(5 * MIN + 10 * MIN + SPEC_TRIAL_MS)
    now += 25 * MIN
    // 끝나면 티켓 시작 + 15분 + 누적 대기.
    expect(budget.endWait('t', 25 * MIN)).toBe(SPEC_WORK_MS + 25 * MIN)
    // 작업 시간은 30분이 지났지만 대기 25분을 빼면 5분이다.
    expect(budget.take('t', 'read_repo', { path: '.' }, 0)).toBeNull()
    now = SPEC_TICKET_MS - 10 * MIN
    budget.endWait('t', 40 * MIN)
    expect(budget.waitCap('t', SPEC_TRIAL_MS)).toBe(10 * MIN)
    expect(budget.startWait('t', 10 * MIN)).toBe(SPEC_TICKET_MS)
    expect(budget.endWait('t', 0)).toBe(SPEC_TICKET_MS)
    now = SPEC_TICKET_MS
    expect(budget.take('t', 'read_repo', { path: 'x' }, 0)).toBe('TIME_LIMIT')
    // 기다리는 사이 결과를 내서 티켓이 끝났으면 쓸 만료가 없다.
    budget.forget('t')
    expect(budget.endWait('t', 1)).toBeNull()
  })
  it('leaves the trial wait in progress out of the working time for calls made during it', () => {
    let now = 0
    const budget = new ToolBudget(() => now)
    expect(budget.take('t', 'run_deploy', {}, 0)).toBeNull()
    budget.startWait('t', SPEC_TRIAL_MS)
    // 대기를 시작하고 20분 뒤 다른 도구를 부른다: 작업 시간은 0분이다.
    now = 20 * MIN
    expect(budget.take('t', 'read_repo', { path: '.' }, 0)).toBeNull()
    budget.endWait('t', 20 * MIN)
    now = 20 * MIN + SPEC_WORK_MS + 1
    expect(budget.take('t', 'read_repo', { path: 'a' }, 0)).toBe('TIME_LIMIT')
  })
  it('after a BE restart starts the ticket 60 minutes before the stored expiry and never moves the expiry earlier', () => {
    // 재시작 전에 늘어난 만료가 지금부터 50분 뒤였다: 티켓 시작은 보수적으로 만료 - 60분.
    let now = 0
    const stored = 50 * MIN
    const budget = new ToolBudget(() => now)
    expect(budget.take('t', 'run_render', {}, stored - SPEC_TICKET_MS, stored)).toBeNull()
    const cap = budget.waitCap('t', SPEC_TRIAL_MS)
    expect(cap).toBe(SPEC_TRIAL_MS)
    expect(budget.startWait('t', cap)).toBe(stored)
    now = 5 * MIN
    expect(budget.endWait('t', 5 * MIN)).toBe(stored)
    now = stored
    expect(budget.take('t', 'read_repo', { path: '.' }, 0)).toBe('TIME_LIMIT')
  })
})
