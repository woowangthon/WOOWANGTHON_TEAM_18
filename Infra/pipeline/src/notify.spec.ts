import { afterEach, describe, expect, it } from 'vitest'
import { checkImages, validateNotice } from '../../../BE/src/deploys/deploy-run.js'
import type { BuildFailure, BuildReport } from './build.js'
import { deployInput, digest } from './fixtures.js'
import { FALLBACK_CODE, noReportNotice, noticeFrom, type NoticeBody, parseStage, pickFailure, sendNotice } from './notify.js'
import { DEPLOY_ID, fakePlatform, TOKEN } from './platform-fake.js'

const NOW = Date.parse('2026-11-11T05:00:00Z')
const now = () => NOW

// BE가 이 본문을 받아 주는가: 매퍼가 만든 모든 본문은 BE의 검사를 통과해야 한다.
const accepted = (body: NoticeBody) => {
  const checked = validateNotice(JSON.parse(JSON.stringify(body)))
  expect(checked, JSON.stringify(checked)).toMatchObject({ ok: true })
  return checked as Extract<typeof checked, { ok: true }>
}

const builtInput = () => {
  const input = deployInput()
  input.deploy_condition.services.fe.image = digest('1')
  input.deploy_condition.services.be.image = digest('2')
  return input
}
const okBuild = (): BuildReport => ({ ok: true, input: builtInput(), builds: { fe: 'cb:1', be: 'cb:2' }, failures: [] })

const buildFailed = (service: string, over: Partial<Extract<BuildFailure, { kind: 'build' }>> = {}): BuildFailure => ({
  service,
  kind: 'build',
  buildStatus: 'FAILED',
  failedPhase: { phaseType: 'BUILD', phaseStatus: 'FAILED', contexts: [{ statusCode: 'COMMAND_EXECUTION_ERROR', message: 'Error while executing command: pnpm run build' }] },
  logTail: ['> vite build', 'error TS2304'],
  build: { id: `cb:${service}`, buildStatus: 'FAILED', startTime: '2026-11-11T10:00:00.123000+09:00', endTime: '2026-11-11T10:03:00+09:00' },
  ...over,
})
const platformFailed = (service: string, code = 'CODEBUILD_API_ERROR'): BuildFailure => ({ service, kind: 'platform', code, message: 'StartBuild throttled' })
const failedBuild = (...failures: BuildFailure[]): BuildReport => ({ ok: false, input: deployInput(), builds: {}, failures })

describe('parseStage', () => {
  it.each(['build', 'prepare', 'render', 'apply', 'verify', 'switch'])('takes %s', (s) => {
    expect(parseStage(s)).toBe(s)
  })
  it.each([undefined, '', 'deploy', 'Build'])('refuses %j', (s) => {
    expect(() => parseStage(s)).toThrow('stage must be one of build, prepare, render, apply, verify, switch')
  })
})

describe('build report', () => {
  it('passed: the image of every run service, none for a reused one', () => {
    const body = noticeFrom(DEPLOY_ID, 'build', okBuild(), now)
    expect(body).toEqual({ deployId: DEPLOY_ID, stage: 'build', result: 'passed', images: { fe: digest('1'), be: digest('2') } })
    const { notice } = accepted(body)
    // BE also compares the images with the run services of the stored run.
    expect(checkImages(okBuild().input.deploy_condition.services as never, (notice as { images: Record<string, string> }).images)).toEqual([])
  })

  it('passed but a run service has no digest: stops instead of sending an incomplete notice', () => {
    const report = okBuild()
    report.input.deploy_condition.services.be.image = null
    expect(() => noticeFrom(DEPLOY_ID, 'build', report, now)).toThrow('build report: service be was built but has no image digest')
  })

  describe('failed', () => {
    it('a build failure: the CodeBuild build is the raw, the log tail and the build times are the logs (UTC)', () => {
      const body = noticeFrom(DEPLOY_ID, 'build', failedBuild(buildFailed('fe')), now)
      expect(body).toEqual({
        deployId: DEPLOY_ID,
        stage: 'build',
        result: 'failed',
        failure: {
          code: null,
          service: 'fe',
          message: 'build FAILED in BUILD: Error while executing command: pnpm run build',
          raw: { codebuild: { id: 'cb:fe', buildStatus: 'FAILED', startTime: '2026-11-11T10:00:00.123000+09:00', endTime: '2026-11-11T10:03:00+09:00' }, k8s: null },
          logs: { from: '2026-11-11T01:00:00.123Z', to: '2026-11-11T01:03:00.000Z', lines: ['> vite build', 'error TS2304'] },
        },
      })
      const { notice } = accepted(body)
      expect(notice).toMatchObject({ failure: { platformCode: null, service: 'fe', evidence: { logs: { from: '2026-11-11T01:00:00.123Z' } } } })
    })

    it('epoch seconds (AWS CLI v1) become UTC times too', () => {
      const build = { id: 'cb:fe', startTime: 1_794_380_400.5, endTime: 1_794_380_460 }
      const body = noticeFrom(DEPLOY_ID, 'build', failedBuild(buildFailed('fe', { build })), now)
      expect(body).toMatchObject({ failure: { logs: { from: '2026-11-11T07:00:00.500Z', to: '2026-11-11T07:01:00.000Z' } } })
      accepted(body)
    })

    it.each([
      ['no times', {}],
      ['times without a zone', { startTime: '2026-11-11 10:00:00', endTime: '2026-11-11T10:03:00' }],
      ['times that are not times', { startTime: 'soon', endTime: null }],
    ])('%s: the logs still carry a valid interval (now), so BE accepts the notice', (_, build) => {
      const body = noticeFrom(DEPLOY_ID, 'build', failedBuild(buildFailed('fe', { build })), now)
      expect(body).toMatchObject({ failure: { logs: { from: '2026-11-11T05:00:00.000Z', to: '2026-11-11T05:00:00.000Z' } } })
      accepted(body)
    })

    it('only an end time: the start is the end', () => {
      const body = noticeFrom(DEPLOY_ID, 'build', failedBuild(buildFailed('fe', { build: { endTime: '2026-11-11T01:03:00Z' } })), now)
      expect(body).toMatchObject({ failure: { logs: { from: '2026-11-11T01:03:00.000Z', to: '2026-11-11T01:03:00.000Z' } } })
    })

    it('a log tail that could not be read becomes no lines; a failed phase that is unknown still gives a message', () => {
      const body = noticeFrom(DEPLOY_ID, 'build', failedBuild(buildFailed('fe', { logTail: null, failedPhase: null })), now)
      expect(body).toMatchObject({ failure: { message: 'build FAILED', logs: { lines: [] } } })
      accepted(body)
    })

    it('a platform failure: only the code, the service and the message (no raw, no logs, no AI)', () => {
      const body = noticeFrom(DEPLOY_ID, 'build', failedBuild(platformFailed('be')), now)
      expect(body).toEqual({ deployId: DEPLOY_ID, stage: 'build', result: 'failed', failure: { code: 'CODEBUILD_API_ERROR', service: 'be', message: 'StartBuild throttled' } })
      expect(accepted(body).notice).toMatchObject({ failure: { platformCode: 'CODEBUILD_API_ERROR', evidence: null } })
    })

    it('several failures: a platform failure wins, wherever it is in the list', () => {
      const body = noticeFrom(DEPLOY_ID, 'build', failedBuild(buildFailed('fe'), platformFailed('be')), now)
      expect(body).toMatchObject({ failure: { code: 'CODEBUILD_API_ERROR', service: 'be' } })
    })

    it('several student failures: the first in the report (spec order)', () => {
      const body = noticeFrom(DEPLOY_ID, 'build', failedBuild(buildFailed('fe'), buildFailed('be')), now)
      expect(body).toMatchObject({ failure: { code: null, service: 'fe' } })
    })

    it('several platform failures: the first', () => {
      const body = noticeFrom(DEPLOY_ID, 'build', failedBuild(platformFailed('fe', 'AWS_CLI_FAILED'), platformFailed('be')), now)
      expect(body).toMatchObject({ failure: { code: 'AWS_CLI_FAILED', service: 'fe' } })
    })

    it.each([
      ['not ok and no failure', failedBuild()],
      ['a failure of an unknown kind', { ...failedBuild(), failures: [{ service: 'fe', kind: 'other' }] }],
      ['a failure that is not an object', { ...failedBuild(), failures: ['x'] }],
      ['no failures list', { ok: false }],
    ])('refuses a report with %s', (_, report) => {
      expect(() => noticeFrom(DEPLOY_ID, 'build', report, now)).toThrow(/^build report: /)
    })
  })

  it('pickFailure says nothing for an empty list', () => {
    expect(pickFailure([])).toBeUndefined()
  })
})

describe('platform failure codes', () => {
  const codeOf = (code: string) => {
    const body = noticeFrom(DEPLOY_ID, 'build', failedBuild(platformFailed('fe', code)), now)
    return body.result === 'failed' ? body.failure : null
  }

  it.each(['K8S_UNREACHABLE', 'AccountLimitExceededException', 'constructor', 'abc', 'A'.repeat(64)])('sends %s as it is', (code) => {
    expect(codeOf(code)).toMatchObject({ code, message: 'StartBuild throttled' })
  })

  it.each(['Bad.Code', 'ab', '1ABC', 'has space', 'A'.repeat(65), 'BUILD_FAILED', 'DEPLOY_FAILED', 'VERIFY_FAILED', 'SWITCH_FAILED', 'AGENT_UNAVAILABLE', 'TIMED_OUT', ''])(
    '%j is a code BE would refuse: it becomes %s with the original in the message, never null (null would call the AI agent)',
    (code) => {
      const failure = codeOf(code)
      expect(failure).toMatchObject({ code: FALLBACK_CODE, message: `${code}: StartBuild throttled` })
      accepted(noticeFrom(DEPLOY_ID, 'build', failedBuild(platformFailed('fe', code)), now))
    },
  )
})

describe.each(['prepare', 'render', 'apply', 'verify', 'switch'] as const)('%s report', (stage) => {
  const student = (raw: Record<string, unknown> = {}) => ({
    ok: false,
    failure: { kind: 'student', service: 'be', errorMessage: 'deployment "be-b" exceeded its progress deadline', raw: { pod: { metadata: { name: 'be-b-1' } }, events: [{ reason: 'BackOff' }], status: null, ...raw } },
  })
  const status = { kind: 'Status', code: 422, reason: 'Invalid', message: 'bad port' }

  it('passed: no images, no failure', () => {
    const body = noticeFrom(DEPLOY_ID, stage, { ok: true, slot: 'b' }, now)
    expect(body).toEqual({ deployId: DEPLOY_ID, stage, result: 'passed' })
    accepted(body)
  })

  it('a platform failure: the code, nothing else of the k3s evidence', () => {
    const body = noticeFrom(DEPLOY_ID, stage, { ok: false, failure: { kind: 'platform', code: 'IMAGE_PULL_FAILED', service: 'be', message: 'pull failed', detail: { token: 'leak?' } } }, now)
    expect(body).toEqual({ deployId: DEPLOY_ID, stage, result: 'failed', failure: { code: 'IMAGE_PULL_FAILED', service: 'be', message: 'pull failed' } })
    expect(accepted(body).notice).toMatchObject({ failure: { platformCode: 'IMAGE_PULL_FAILED', evidence: null } })
  })

  it('a platform failure without a service keeps null', () => {
    const body = noticeFrom(DEPLOY_ID, stage, { ok: false, failure: { kind: 'platform', code: 'K8S_UNREACHABLE', service: null, message: 'timeout' } }, now)
    expect(body).toMatchObject({ failure: { service: null } })
    accepted(body)
  })

  it('a student failure: code null, the message and the k3s raw (status only where BE wants it)', () => {
    const wantsStatus = stage === 'render'
    const body = noticeFrom(DEPLOY_ID, stage, student({ status }), now)
    expect(body).toEqual({
      deployId: DEPLOY_ID,
      stage,
      result: 'failed',
      failure: {
        code: null,
        service: 'be',
        message: 'deployment "be-b" exceeded its progress deadline',
        raw: { codebuild: null, k8s: { pod: { metadata: { name: 'be-b-1' } }, events: [{ reason: 'BackOff' }], status: wantsStatus ? status : null } },
      },
    })
    accepted(body)
  })

  it('a student failure whose raw is missing parts: the pod becomes null, the events an empty list', () => {
    const body = noticeFrom(DEPLOY_ID, stage, student({ pod: 'x', events: undefined, status: stage === 'render' ? status : null }), now)
    expect(body).toMatchObject({ failure: { raw: { k8s: { pod: null, events: [] } } } })
    accepted(body)
  })
})

describe('render student failure whose k3s status could not be read', () => {
  it.each([null, undefined, 'text', 7, []])('sends the error message as the status (%j), because BE refuses a render ticket without one', (status) => {
    const body = noticeFrom(DEPLOY_ID, 'render', { ok: false, failure: { kind: 'student', service: 'fe', errorMessage: 'dry run refused', raw: { pod: null, events: [], status } } }, now)
    expect(body).toMatchObject({ failure: { raw: { k8s: { status: { message: 'dry run refused' } } } } })
    accepted(body)
  })
})

describe('prepare student failure (quota) has no service', () => {
  it('keeps service null', () => {
    const body = noticeFrom(DEPLOY_ID, 'prepare', { ok: false, failure: { kind: 'student', service: null, errorMessage: 'resources of both slots exceed the project quota', raw: { pod: null, events: [], status: null } } }, now)
    expect(body).toMatchObject({ failure: { code: null, service: null } })
    accepted(body)
  })
})

describe('reports that do not fit', () => {
  it.each([
    ['null', null],
    ['an array', []],
    ['no ok', {}],
    ['an ok that is not a boolean', { ok: 'true' }],
    ['not ok and no failure', { ok: false }],
    ['not ok and a failure of an unknown kind', { ok: false, failure: { kind: 'other' } }],
    ['not ok and a failure that is a string', { ok: false, failure: 'x' }],
  ])('apply report: %s', (_, report) => {
    expect(() => noticeFrom(DEPLOY_ID, 'apply', report, now)).toThrow(/^apply report: /)
  })
})

describe('noReportNotice', () => {
  it.each(['build', 'prepare', 'render', 'apply', 'verify', 'switch'] as const)('%s: a platform failure STAGE_NO_REPORT that BE closes as failed without the AI', (stage) => {
    const body = noReportNotice(DEPLOY_ID, stage)
    expect(body).toEqual({ deployId: DEPLOY_ID, stage, result: 'failed', failure: { code: 'STAGE_NO_REPORT', service: null, message: `the ${stage} stage left no readable report` } })
    expect(accepted(body).notice).toMatchObject({ failure: { platformCode: 'STAGE_NO_REPORT', service: null, evidence: null } })
  })
})

describe('sendNotice', () => {
  let platform: Awaited<ReturnType<typeof fakePlatform>> | undefined
  afterEach(async () => {
    await platform?.close()
    platform = undefined
  })

  it('posts the body to /api/pipeline/notify with the token', async () => {
    platform = await fakePlatform(() => ({ status: 200, body: { ok: true } }))
    const body = noticeFrom(DEPLOY_ID, 'build', okBuild(), now)
    expect(await sendNotice({ url: new URL(platform.url), token: TOKEN }, body, () => Promise.resolve())).toEqual({ applied: true })
    expect(platform.seen).toHaveLength(1)
    expect(platform.seen[0]).toMatchObject({ method: 'POST', url: '/api/pipeline/notify' })
    expect(platform.seen[0].headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(JSON.parse(platform.seen[0].body)).toEqual(body)
  })

  it('says the server did not change the run when it answers applied: false', async () => {
    platform = await fakePlatform(() => ({ status: 200, body: { ok: true, applied: false } }))
    expect(await sendNotice({ url: new URL(platform.url), token: TOKEN }, noReportNotice(DEPLOY_ID, 'apply'), () => Promise.resolve())).toEqual({ applied: false })
  })
})
