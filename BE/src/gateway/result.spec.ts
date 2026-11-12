import { describe, expect, it } from 'vitest'
import { type AgentResult, checkResult, storedResult } from './result.js'

const SHA = 'a'.repeat(40)
const ticket = { ticketId: 't_1', commitSha: SHA }
const base = {
  ticketId: 't_1',
  commitSha: SHA,
  status: 'gave_up',
  classification: { method: 'llm', caseId: null, path: 'plan' },
  actions: [{ tool: 'read_repo', ok: true, args: { path: '.' }, result: 'ok' }],
  evidence: [{ ref: 'logs', text: 'Error: listen EADDRINUSE' }],
  summary: '원인을 찾지 못했습니다.',
}
const message = (overrides: Record<string, unknown>) => {
  const checked = checkResult({ ...base, ...overrides }, ticket)
  return checked.ok ? null : checked.message
}

describe('checkResult', () => {
  it.each([
    ['gave_up', {}],
    ['needs_user', { status: 'needs_user', userRequest: { message: 'DATABASE_URL을 넣어 주세요', secretKeys: ['DATABASE_URL'] } }],
    ['pr_opened', { status: 'pr_opened', pr: { url: 'https://github.com/a/b/pull/1', files: ['a', 'b', 'c', 'd', 'e'], changedLines: 50 } }],
    ['null optional fields', { pr: null, userRequest: null, specPatch: null, buildOverrides: null, evidence: undefined }],
    ['verified with an empty specPatch (only re-ran)', { status: 'verified', specPatch: [] }],
    ['verified with a specPatch and buildOverrides', { status: 'verified', specPatch: [{ op: 'replace', path: '/spec/services/0/runtime/port', value: 8000 }], buildOverrides: { cache: false } }],
  ])('accepts %s', (_label, overrides) => {
    expect(message(overrides)).toBeNull()
  })

  it.each([
    [{ status: 'verified' }, /verified requires specPatch/],
    [{ status: 'verified', specPatch: {} }, /verified requires specPatch/],
    [{ status: 'verified', specPatch: [], buildOverrides: [] }, /buildOverrides must be an object/],
    [{ specPatch: [{ op: 'replace' }] }, /specPatch/],
    [{ buildOverrides: {} }, /buildOverrides/],
    [{ status: 'done' }, /status/],
    [{ ticketId: 't_2' }, /ticketId/],
    [{ commitSha: 'b'.repeat(40) }, /commitSha/],
    [{ other: 1 }, /unknown key other/],
    [{ classification: { method: 'code', caseId: 1, path: 'plan' } }, /classification/],
    [{ classification: { method: 'code', caseId: 'A1', path: 'guess' } }, /classification/],
    [{ actions: {} }, /actions must be an array/],
    [{ actions: [{ tool: 'x' }] }, /tool and ok/],
    [{ actions: [{ tool: 'x', ok: true, args: 'a' }] }, /args/],
    [{ actions: [{ tool: 'x', ok: true, result: 1 }] }, /result/],
    [{ summary: '' }, /summary/],
    [{ evidence: [{ ref: 1 }] }, /evidence/],
    [{ pr: 'x' }, /pr must be an object/],
    [{ pr: { url: 1 } }, /pr.url/],
    [{ pr: { files: ['a', 'b', 'c', 'd', 'e', 'f'] } }, /pr.files/],
    [{ pr: { changedLines: 51 } }, /changedLines/],
    [{ pr: { changedLines: 1.5 } }, /changedLines/],
    [{ userRequest: { message: ' ' } }, /userRequest needs a message/],
    [{ userRequest: { message: 'm', secretKeys: [1] } }, /secretKeys/],
    [{ status: 'pr_opened' }, /requires pr/],
    [{ status: 'needs_user' }, /requires userRequest/],
  ])('rejects %j', (overrides, why) => {
    expect(message(overrides)).toMatch(why)
  })

  it('rejects a result that is not an object', () => {
    expect(checkResult([base], ticket)).toEqual({ ok: false, message: 'result must be an object' })
  })

  it('stores only the student-facing fields, dropping extra keys in nested objects', () => {
    const checked = checkResult(
      {
        ...base,
        status: 'pr_opened',
        actions: [{ tool: 'read_pod_logs', ok: true, result: 'raw log line' }],
        classification: { method: 'code', caseId: 'A1', path: 'playbook', rawLogs: ['x'] },
        pr: { url: 'https://github.com/a/b/pull/1', files: ['a'], changedLines: 1, diff: '+secret' },
        userRequest: { message: '값을 넣어 주세요', secretKeys: ['DATABASE_URL'], rawLogs: ['Error: …'] },
        evidence: [{ ref: 'logs', text: 'line', raw: { pod: {} } }, {}],
      },
      ticket,
    )
    expect(checked.ok).toBe(true)
    expect(storedResult((checked as { result: AgentResult }).result)).toEqual({
      status: 'pr_opened',
      summary: base.summary,
      userRequest: { message: '값을 넣어 주세요', secretKeys: ['DATABASE_URL'] },
      pr: { url: 'https://github.com/a/b/pull/1', files: ['a'], changedLines: 1 },
      evidence: [
        { ref: 'logs', text: 'line' },
        { ref: null, text: null },
      ],
      classification: { method: 'code', caseId: 'A1', path: 'playbook' },
    })
  })

  it('stores missing optional fields as empty values', () => {
    const checked = checkResult({ ...base, evidence: undefined, userRequest: { message: 'm' } }, ticket)
    const stored = storedResult((checked as { result: AgentResult }).result)
    expect(stored).toMatchObject({ userRequest: { message: 'm', secretKeys: [] }, pr: null, evidence: [] })
  })
})
