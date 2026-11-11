import { describe, expect, it } from 'vitest'
import type { ServiceConditions } from './deploy-condition.js'
import { buildSteps, checkImages, classifyFailure, nextStage, publicUrl, STAGES, toFailure, validateNotice } from './deploy-run.js'

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
    ['verify', 'VERIFY_FAILED', false],
    ['switch', 'SWITCH_FAILED', false],
  ] as const)('%s fails as %s (agent: %s)', (stage, code, callAgent) => {
    expect(classifyFailure(stage, null)).toEqual({ code, callAgent })
  })

  it('never calls the agent for a platform problem, whatever the stage', () => {
    for (const stage of STAGES) {
      expect(classifyFailure(stage, 'CODEBUILD_API_ERROR')).toEqual({ code: 'CODEBUILD_API_ERROR', callAgent: false })
      expect(classifyFailure(stage, 'IMAGE_PULL_FAILED').callAgent).toBe(false)
      expect(classifyFailure(stage, 'LIVE_SLOT_PROTECTED').callAgent).toBe(false)
    }
  })
})

describe('toFailure', () => {
  it('adds a fixed sentence and nothing else', () => {
    const f = toFailure({ code: 'BUILD_FAILED', stage: 'build', service: 'fe' })
    expect(Object.keys(f).sort()).toEqual(['code', 'message', 'service', 'stage'])
    expect(f.message).toMatch(/이미지/)
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

  it('reads a failed notice, defaulting code · service to null and raw to {}', () => {
    const r = validateNotice({ deployId: ID, stage: 'apply', result: 'failed', failure: { message: 'boom' } })
    expect(r).toEqual({
      ok: true,
      notice: { deployId: ID, stage: 'apply', result: 'failed', failure: { platformCode: null, service: null, message: 'boom', raw: {}, logs: null } },
    })
  })

  it('checks the failure fields', () => {
    const base = { deployId: ID, stage: 'apply', result: 'failed' }
    expect(paths(base)).toEqual(['failure:REQUIRED'])
    expect(paths({ ...base, failure: 'x' })).toEqual(['failure:INVALID_TYPE'])
    expect(paths({ ...base, failure: { message: 'm', code: 'OTHER', service: 'Bad Name', raw: [] } })).toEqual([
      'failure.code:INVALID_VALUE',
      'failure.service:INVALID_VALUE',
      'failure.raw:INVALID_TYPE',
    ])
    expect(paths({ ...base, failure: {} })).toEqual(['failure.message:REQUIRED'])
  })

  it('cuts a very long failure message', () => {
    const r = validateNotice({ deployId: ID, stage: 'apply', result: 'failed', failure: { message: 'x'.repeat(5000) } })
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
