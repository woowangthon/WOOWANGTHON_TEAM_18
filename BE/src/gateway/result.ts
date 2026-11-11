import { isRecord } from '../common/is-record.js'

// `submit_result`의 해결 결과 검사(docs/design/AIagent.md §6). 모양이 다르면 INVALID_RESULT다.
// `verified`는 F11b 전까지 받지 않는다: 실행 도구가 없어 대상 슬롯에서 확인한 적이 없기 때문이다.

export type AcceptedStatus = 'pr_opened' | 'needs_user' | 'gave_up'

export interface AgentResult {
  ticketId: string
  commitSha: string
  status: AcceptedStatus
  classification: { method: 'code' | 'llm'; caseId: string | null; path: 'playbook' | 'replan_after_playbook' | 'plan' }
  actions: { tool: string; ok: boolean; args?: Record<string, unknown>; result?: string }[]
  pr?: { url?: string; files?: string[]; changedLines?: number } | null
  userRequest?: { message: string; secretKeys?: string[] } | null
  evidence?: { ref?: string; text?: string }[]
  summary: string
}

const KEYS = ['ticketId', 'commitSha', 'status', 'classification', 'actions', 'specPatch', 'buildOverrides', 'pr', 'userRequest', 'evidence', 'summary']
const STATUSES = ['verified', 'pr_opened', 'needs_user', 'gave_up']
const PATHS = ['playbook', 'replan_after_playbook', 'plan']

const isString = (v: unknown): v is string => typeof v === 'string'
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString)
const absent = (v: unknown) => v === undefined || v === null

/** 틀린 칸 하나를 찾아 그 이유를 돌려준다. 맞으면 null. */
function problem(r: Record<string, unknown>, ticket: { ticketId: string; commitSha: string }): string | null {
  const unknown = Object.keys(r).find((k) => !KEYS.includes(k))
  if (unknown) return `unknown key ${unknown}`
  if (r.ticketId !== ticket.ticketId) return 'ticketId differs from the ticket'
  if (r.commitSha !== ticket.commitSha) return 'commitSha differs from the ticket'
  if (!isString(r.status) || !STATUSES.includes(r.status)) return 'status is not one of verified, pr_opened, needs_user, gave_up'
  if (r.status === 'verified') return 'verified is not accepted yet: the gateway has no trial-run tools to confirm it on the target slot'
  if (!absent(r.specPatch) || !absent(r.buildOverrides)) return 'specPatch and buildOverrides belong to a verified result'

  const c = r.classification
  if (!isRecord(c) || (c.method !== 'code' && c.method !== 'llm') || !(c.caseId === null || isString(c.caseId)) || !PATHS.includes(c.path as string)) {
    return 'classification needs method (code, llm), caseId (string or null) and path (playbook, replan_after_playbook, plan)'
  }
  if (!Array.isArray(r.actions)) return 'actions must be an array'
  for (const a of r.actions) {
    if (!isRecord(a) || !isString(a.tool) || typeof a.ok !== 'boolean') return 'each action needs tool and ok'
    if (!absent(a.args) && !isRecord(a.args)) return 'action args must be an object'
    if (!absent(a.result) && !isString(a.result)) return 'action result must be a string'
  }
  if (!isString(r.summary) || r.summary.trim() === '') return 'summary is required'
  if (!absent(r.evidence)) {
    if (!Array.isArray(r.evidence) || !r.evidence.every((e) => isRecord(e) && (absent(e.ref) || isString(e.ref)) && (absent(e.text) || isString(e.text)))) {
      return 'evidence must be a list of { ref, text } strings'
    }
  }
  if (!absent(r.pr)) {
    const pr = r.pr
    if (!isRecord(pr)) return 'pr must be an object'
    if (!absent(pr.url) && !isString(pr.url)) return 'pr.url must be a string'
    if (!absent(pr.files) && !(isStrings(pr.files) && pr.files.length <= 5)) return 'pr.files is at most 5 paths'
    if (!absent(pr.changedLines) && !(Number.isInteger(pr.changedLines) && (pr.changedLines as number) >= 0 && (pr.changedLines as number) <= 50)) {
      return 'pr.changedLines is an integer from 0 to 50'
    }
  }
  if (!absent(r.userRequest)) {
    const u = r.userRequest
    if (!isRecord(u) || !isString(u.message) || u.message.trim() === '') return 'userRequest needs a message'
    if (!absent(u.secretKeys) && !isStrings(u.secretKeys)) return 'userRequest.secretKeys must be strings'
  }
  // §6 표: status마다 플랫폼이 읽는 칸이 있어야 한다.
  if (r.status === 'pr_opened' && absent(r.pr)) return 'status pr_opened requires pr'
  if (r.status === 'needs_user' && absent(r.userRequest)) return 'status needs_user requires userRequest'
  return null
}

export function checkResult(value: unknown, ticket: { ticketId: string; commitSha: string }): { ok: true; result: AgentResult } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: 'result must be an object' }
  const why = problem(value, ticket)
  return why === null ? { ok: true, result: value as unknown as AgentResult } : { ok: false, message: why }
}
