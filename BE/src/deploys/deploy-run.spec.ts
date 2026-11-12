import { describe, expect, it } from 'vitest'
import type { ServiceConditions } from './deploy-condition.js'
import { buildSteps, checkImages, classifyFailure, nextStage, publicUrl, STAGES, ticketCount, toFailure, validateNotice } from './deploy-run.js'

const ID = '6f1c0a52-3b7e-4a40-9a6c-2f5d8e1b7c90'
const IMAGE = `ghcr.io/woowang-bot/student-apps@sha256:${'c'.repeat(64)}`
const states = (status: Parameters<typeof buildSteps>[0], stage: Parameters<typeof buildSteps>[1]) =>
  buildSteps(status, stage).map((s) => s.state[0]).join('')

describe('nextStage', () => {
  it('follows the pipeline order and ends after switch', () => {
    expect(STAGES.map(nextStage)).toEqual(['prepare', 'render', 'apply', 'verify', 'switch', null])
  })
})

describe('buildSteps', () => {
  it('always lists the eight steps of FR-060 in order', () => {
    expect(buildSteps('not_started', null).map((s) => s.key)).toEqual(['intake', 'analysis', 'config', 'secrets', 'build', 'deploy', 'verify', 'done'])
  })

  // d done, a active, p pending, f failed
  it.each([
    ['not_started', null, 'dddapppp'],
    ['running', 'build', 'ddddappp'],
    ['running', 'prepare', 'dddddapp'],
    ['running', 'render', 'dddddapp'],
    ['running', 'apply', 'dddddapp'],
    ['running', 'verify', 'ddddddap'],
    ['running', 'switch', 'ddddddda'],
    ['fixing', 'apply', 'dddddapp'],
    ['failed', 'build', 'ddddfppp'],
    ['failed', 'verify', 'ddddddfp'],
    ['succeeded', null, 'dddddddd'],
  ] as const)('%s at %s', (status, stage, expected) => {
    expect(states(status, stage)).toBe(expected)
  })
})

describe('classifyFailure', () => {
  it.each([
    ['build', 'BUILD_FAILED', true],
    ['prepare', 'DEPLOY_FAILED', true],
    ['render', 'DEPLOY_FAILED', true],
    ['apply', 'DEPLOY_FAILED', true],
    ['verify', 'VERIFY_FAILED', true],
    ['switch', 'SWITCH_FAILED', false],
  ] as const)('%s fails as %s (agent: %s)', (stage, code, callAgent) => {
    expect(classifyFailure(stage, null)).toEqual({ code, callAgent })
  })

  it('never calls the agent for a platform problem, whatever the stage', () => {
    for (const stage of STAGES) {
      expect(classifyFailure(stage, 'CODEBUILD_API_ERROR')).toEqual({ code: 'CODEBUILD_API_ERROR', callAgent: false })
      expect(classifyFailure(stage, 'IMAGE_PULL_FAILED').callAgent).toBe(false)
      expect(classifyFailure(stage, 'LIVE_SLOT_PROTECTED').callAgent).toBe(false)
      expect(classifyFailure(stage, 'CHART_RENDER_FAILED')).toEqual({ code: 'CHART_RENDER_FAILED', callAgent: false })
    }
  })
})

describe('toFailure', () => {
  it('adds a fixed sentence and nothing else', () => {
    const f = toFailure({ code: 'BUILD_FAILED', stage: 'build', service: 'fe' })
    expect(Object.keys(f).sort()).toEqual(['code', 'message', 'service', 'stage'])
    expect(f.message).toMatch(/이미지/)
  })

  it('gives a platform code without its own message the generic one', () => {
    expect(toFailure({ code: 'K8S_UNREACHABLE', stage: 'apply', service: null }).message).toBe('플랫폼 문제로 배포하지 못했습니다. 운영자가 확인합니다.')
    for (const code of ['constructor', 'toString', 'hasOwnProperty']) {
      expect(toFailure({ code, stage: 'apply', service: null }).message).toBe('플랫폼 문제로 배포하지 못했습니다. 운영자가 확인합니다.')
    }
  })
})

describe('publicUrl', () => {
  it('is https://<slug>.stairnoworks.com', () => expect(publicUrl('my-app')).toBe('https://my-app.stairnoworks.com'))
})

describe('validateNotice', () => {
  const paths = (body: unknown) => {
    const r = validateNotice(body)
    return r.ok ? [] : r.issues.map((i) => `${i.path}:${i.code}`)
  }

  it('accepts a passed notice and lower-cases the id', () => {
    const r = validateNotice({ deployId: ID.toUpperCase(), stage: 'apply', result: 'passed' })
    expect(r).toEqual({ ok: true, notice: { deployId: ID, stage: 'apply', result: 'passed', images: null } })
  })

  it('requires images on a passed build and takes only digests', () => {
    expect(paths({ deployId: ID, stage: 'build', result: 'passed' })).toEqual(['images:REQUIRED'])
    expect(paths({ deployId: ID, stage: 'build', result: 'passed', images: { fe: 'ghcr.io/x/y:latest' } })).toEqual(['images.fe:INVALID_VALUE'])
    expect(validateNotice({ deployId: ID, stage: 'build', result: 'passed', images: { fe: IMAGE } }).ok).toBe(true)
  })

  it('rejects images on any other stage', () => {
    expect(paths({ deployId: ID, stage: 'apply', result: 'passed', images: {} })).toEqual(['images:UNKNOWN_KEY'])
  })

  it('rejects a body that is not an object, and bad envelope values', () => {
    expect(paths(null)).toEqual([':INVALID_TYPE'])
    expect(paths([])).toEqual([':INVALID_TYPE'])
    expect(paths({})).toEqual(['deployId:REQUIRED', 'stage:REQUIRED', 'result:REQUIRED'])
    expect(paths({ deployId: 'x', stage: 'deploy', result: 'ok' })).toEqual(['deployId:INVALID_VALUE', 'stage:INVALID_VALUE', 'result:INVALID_VALUE'])
  })

  describe('a failed notice', () => {
    const FROM = '2026-11-11T01:00:00Z'
    const k8s = (status: unknown = null) => ({ pod: null, events: [], status })
    const failed = (stage: string, failure: Record<string, unknown>) => ({ deployId: ID, stage, result: 'failed', failure: { message: 'boom', ...failure } })
    const notice = (body: unknown) => {
      const r = validateNotice(body)
      if (!r.ok) throw new Error(JSON.stringify(r.issues))
      return r.notice as Extract<typeof r.notice, { result: 'failed' }>
    }

    it('keeps the evidence in the shape the AI server takes', () => {
      const n = notice(failed('build', { service: 'fe', raw: { codebuild: { id: 'cb:1' } }, logs: { from: FROM, to: FROM, lines: ['a'] } }))
      expect(n.failure).toEqual({
        platformCode: null,
        service: 'fe',
        message: 'boom',
        evidence: { raw: { codebuild: { id: 'cb:1' }, k8s: null }, logs: { from: FROM, to: FROM, lines: ['a'] } },
      })
    })

    it('fills pod and events with null and [] for a k8s stage, and takes no logs as null', () => {
      const n = notice(failed('apply', { raw: { k8s: {} } }))
      expect(n.failure.evidence).toEqual({ raw: { codebuild: null, k8s: k8s() }, logs: null })
    })

    it('keeps only the last 200 log lines', () => {
      const lines = Array.from({ length: 250 }, (_, i) => `l${i}`)
      const n = notice(failed('apply', { raw: { k8s: {} }, logs: { from: FROM, to: FROM, lines } }))
      expect(n.failure.evidence?.logs?.lines).toEqual(lines.slice(50))
    })

    it.each([
      ['build without codebuild', failed('build', {}), ['failure.raw.codebuild:REQUIRED']],
      ['build with k8s', failed('build', { raw: { codebuild: {}, k8s: {} } }), ['failure.raw.k8s:MUST_BE_NULL']],
      ['apply without k8s', failed('apply', {}), ['failure.raw.k8s:REQUIRED']],
      ['apply with codebuild', failed('apply', { raw: { codebuild: {}, k8s: {} } }), ['failure.raw.codebuild:MUST_BE_NULL']],
      ['render without status', failed('render', { raw: { k8s: {} } }), ['failure.raw.k8s.status:REQUIRED']],
      ['apply with status', failed('apply', { raw: { k8s: { status: {} } } }), ['failure.raw.k8s.status:MUST_BE_NULL']],
      ['prepare with status', failed('prepare', { raw: { k8s: { status: {} } } }), ['failure.raw.k8s.status:MUST_BE_NULL']],
      ['raw that is not an object', failed('apply', { raw: [] }), ['failure.raw:INVALID_TYPE']],
      ['pod that is not an object', failed('apply', { raw: { k8s: { pod: 'x' } } }), ['failure.raw.k8s.pod:INVALID_TYPE']],
      ['events that are not objects', failed('apply', { raw: { k8s: { events: ['x'] } } }), ['failure.raw.k8s.events:INVALID_TYPE']],
      ['logs without a time zone', failed('apply', { raw: { k8s: {} }, logs: { from: '2026-11-11T01:00:00', to: FROM, lines: [] } }), ['failure.logs.from:INVALID_VALUE']],
      ['logs with a missing to', failed('apply', { raw: { k8s: {} }, logs: { from: FROM, lines: [] } }), ['failure.logs.to:REQUIRED']],
      ['log lines that are not strings', failed('apply', { raw: { k8s: {} }, logs: { from: FROM, to: FROM, lines: [1] } }), ['failure.logs.lines:INVALID_TYPE']],
    ])('rejects %s', (_n, body, expected) => {
      const r = validateNotice(body)
      expect(r.ok ? [] : r.issues.map((i) => `${i.path}:${i.code}`)).toEqual(expected)
    })

    it('does not look at the evidence of a platform problem or of a switch failure (no ticket goes out)', () => {
      expect(notice(failed('build', { code: 'CODEBUILD_API_ERROR', raw: 'garbage' })).failure.evidence).toBeNull()
      expect(notice(failed('switch', { raw: 'garbage', logs: 5 })).failure.evidence).toBeNull()
    })
  })

  it('checks the failure envelope', () => {
    const base = { deployId: ID, stage: 'switch', result: 'failed' }
    expect(paths(base)).toEqual(['failure:REQUIRED'])
    expect(paths({ ...base, failure: 'x' })).toEqual(['failure:INVALID_TYPE'])
    expect(paths({ ...base, failure: { message: 'm', code: 'x', service: 'Bad Name' } })).toEqual(['failure.code:INVALID_VALUE', 'failure.service:INVALID_VALUE'])
    expect(paths({ ...base, failure: {} })).toEqual(['failure.message:REQUIRED'])
  })

  it.each([['K8S_TIMEOUT', []], ['AccountLimitExceededException', []], ['with space', ['failure.code:INVALID_VALUE']], ['9ABC', ['failure.code:INVALID_VALUE']], ['BUILD_FAILED', ['failure.code:INVALID_VALUE']], ['TIMED_OUT', ['failure.code:INVALID_VALUE']], ['AB', ['failure.code:INVALID_VALUE']], ['A'.repeat(65), ['failure.code:INVALID_VALUE']], ['A'.repeat(64), []]])('failure.code %s: %j', (code, expected) => {
    expect(paths({ deployId: ID, stage: 'apply', result: 'failed', failure: { message: 'm', code, service: null } })).toEqual(expected)
  })

  it('cuts a very long failure message', () => {
    const r = validateNotice({ deployId: ID, stage: 'switch', result: 'failed', failure: { message: 'x'.repeat(5000) } })
    expect(r.ok && r.notice.result === 'failed' && r.notice.failure.message.length).toBe(2000)
  })
})

describe('checkImages', () => {
  const conditions: ServiceConditions = {
    fe: { buildInputHash: `sha256:${'a'.repeat(64)}`, build: 'run', image: null },
    be: { buildInputHash: `sha256:${'b'.repeat(64)}`, build: 'reuse', image: IMAGE },
  }
  it('passes when exactly the run services have an image', () => {
    expect(checkImages(conditions, { fe: IMAGE })).toEqual([])
  })
  it('names a missing run service and an image for a service that was not built', () => {
    expect(checkImages(conditions, {})).toEqual([{ path: 'images.fe', code: 'REQUIRED' }])
    expect(checkImages(conditions, { fe: IMAGE, be: IMAGE, ghost: IMAGE })).toEqual([
      { path: 'images.be', code: 'UNKNOWN_KEY' },
      { path: 'images.ghost', code: 'UNKNOWN_KEY' },
    ])
  })
})

describe('ticketCount', () => {
  it.each([
    ['no run', undefined, 1],
    ['no earlier result', { agent_result: null }, 1],
    ['an earlier verified result of the first ticket', { agent_result: { status: 'verified', tickets: 1 } }, 2],
    ['the third ticket after two', { agent_result: { tickets: 2 } }, 3],
    ['a count that is not a positive integer', { agent_result: { tickets: '2' } }, 1],
    ['a zero count', { agent_result: { tickets: 0 } }, 1],
    ['a negative count', { agent_result: { tickets: -1 } }, 1],
    ['a fractional count', { agent_result: { tickets: 1.5 } }, 1],
  ])('is the next ticket number with %s', (_label, run, n) => {
    expect(ticketCount(run)).toBe(n)
  })
})
