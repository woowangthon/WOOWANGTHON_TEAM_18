import { afterEach, describe, expect, it } from 'vitest'
import { checkTrialResult } from '../../../BE/src/gateway/trial-result.js'
import type { BuildFailure, BuildReport } from './build.js'
import type { DeployInput } from './deploy-input.js'
import type { StageFailure } from './failure.js'
import { builtDeployInput, deployInput, digest } from './fixtures.js'
import { fakePlatform, TOKEN } from './platform-fake.js'
import { noReportBody, parseTrialStage, parseTrialStages, sendTrialResult, type Trial, type TrialBody, trialBodyFrom } from './trial-report.js'

const now = () => Date.parse('2026-11-12T05:00:00Z')
const RENDER = parseTrialStages('render')
const DEPLOY = parseTrialStages('prepare,render,apply')
const VERIFY = parseTrialStages('verify')
const BUILD = parseTrialStages('build')

// BE가 이 본문을 받아 주는가(BE/src/gateway/trial-result.ts). run_build는 BE가 아직 받지 않아(B3) 도구 표의 칸만 본다.
const accepted = (trial: Trial, body: TrialBody | null) => {
  expect(body).not.toBeNull()
  if (trial.tool === 'run_build') {
    expect(Object.keys(body!.result).sort()).toEqual(['build', 'failedPhase', 'failure', 'image', 'logTail', 'ok', 'reused'])
    return body!
  }
  expect(checkTrialResult(trial.tool, JSON.parse(JSON.stringify(body)))).toEqual([])
  return body!
}

const student = (over: Partial<Extract<StageFailure, { kind: 'student' }>> = {}): StageFailure => ({
  kind: 'student',
  service: 'be',
  errorMessage: 'be: CrashLoopBackOff',
  raw: { pod: { metadata: { name: 'be-b-1' } }, events: [{ reason: 'BackOff' }], status: null },
  ...over,
})
const platform = (code = 'K8S_TIMEOUT', service: string | null = null): StageFailure => ({ kind: 'platform', code, service, message: 'GET pods did not answer in 10s' })

describe('parseTrialStages and parseTrialStage', () => {
  it.each([
    ['build', 'run_build', ['build']],
    ['render', 'run_render', ['render']],
    ['prepare,render,apply', 'run_deploy', ['prepare', 'render', 'apply']],
    ['verify', 'run_verify', ['verify']],
  ])('%s is %s', (v, tool, stages) => {
    expect(parseTrialStages(v)).toEqual({ tool, stages })
  })

  it.each([undefined, '', 'apply', 'prepare,render', 'render,verify', 'constructor', '__proto__', 'Build'])('refuses TRIAL_STAGES %j', (v) => {
    expect(() => parseTrialStages(v)).toThrow('TRIAL_STAGES must be one of build | render | prepare,render,apply | verify')
  })

  it('takes the five trial stages and not switch', () => {
    for (const s of ['build', 'prepare', 'render', 'apply', 'verify']) expect(parseTrialStage(s)).toBe(s)
    expect(() => parseTrialStage('switch')).toThrow('stage must be one of build, prepare, render, apply, verify')
  })
})

describe('trialBodyFrom: once per trial', () => {
  it('sends nothing for a passed stage that is not the last of TRIAL_STAGES', () => {
    expect(trialBodyFrom(DEPLOY, 'prepare', { ok: true, failure: null }, deployInput())).toBeNull()
    expect(trialBodyFrom(DEPLOY, 'render', { ok: true, failure: null }, deployInput())).toBeNull()
  })

  it('refuses a stage outside the trial and a report without a boolean ok', () => {
    expect(() => trialBodyFrom(RENDER, 'apply', { ok: true }, deployInput())).toThrow('apply report: stage apply is not in this trial (render)')
    expect(() => trialBodyFrom(RENDER, 'render', { ok: 'yes' }, deployInput())).toThrow('render report: has no boolean ok')
  })

  it('refuses a failed report without a failure of a known kind', () => {
    expect(() => trialBodyFrom(RENDER, 'render', { ok: false, failure: null }, deployInput())).toThrow('is not ok but has no failure of kind platform or student')
    expect(() => trialBodyFrom(RENDER, 'render', { ok: false, failure: { kind: 'other' } }, deployInput())).toThrow('is not ok but has no failure of kind platform or student')
  })
})

describe('run_render', () => {
  it('passed: ok, status null, failure null', () => {
    const body = accepted(RENDER, trialBodyFrom(RENDER, 'render', { ok: true, failure: null }, deployInput()))
    expect(body).toEqual({ stage: 'render', result: { ok: true, status: null, failure: null } })
  })

  it('student: the k3s Status and its message, code null', () => {
    const status = { kind: 'Status', code: 422, message: 'Deployment.apps "be-b" is invalid: spec.template.spec.containers[0].ports[0].containerPort: Invalid value: 70000' }
    const f = student({ errorMessage: status.message, raw: { pod: null, events: [], status } })
    const body = accepted(RENDER, trialBodyFrom(RENDER, 'render', { ok: false, failure: f }, deployInput()))
    expect(body).toEqual({ stage: 'render', result: { ok: false, status, failure: { stage: 'render', code: null, message: status.message } } })
  })

  it('platform: the code, status null', () => {
    const body = accepted(RENDER, trialBodyFrom(RENDER, 'render', { ok: false, failure: platform('CHART_RENDER_FAILED') }, deployInput()))
    expect(body.result).toEqual({ ok: false, status: null, failure: { stage: 'render', code: 'CHART_RENDER_FAILED', message: 'GET pods did not answer in 10s' } })
  })

  it('a code BE cannot take becomes PIPELINE_FAILED with the code in the message (as in notify)', () => {
    const body = accepted(RENDER, trialBodyFrom(RENDER, 'render', { ok: false, failure: platform('x') }, deployInput()))
    expect(body.result.failure).toEqual({ stage: 'render', code: 'PIPELINE_FAILED', message: 'x: GET pods did not answer in 10s' })
  })
})

describe('run_deploy', () => {
  const applyReport = (ready: string[], failure: StageFailure | null) => ({ ok: failure === null, slot: 'b', ready, failure })

  it('passed at apply: every service Ready in apply order (AI → BE → FE), no Pods or events', () => {
    const body = accepted(DEPLOY, trialBodyFrom(DEPLOY, 'apply', applyReport(['ai', 'be', 'fe'], null), deployInput()))
    expect(body).toEqual({
      stage: 'apply',
      result: {
        ok: true,
        services: [
          { service: 'ai', ready: true, reason: null },
          { service: 'be', ready: true, reason: null },
          { service: 'fe', ready: true, reason: null },
        ],
        pods: [],
        events: [],
        failure: null,
      },
    })
  })

  it('student failure at apply: the failed service with the reason, the rest not applied, the Pod and events of the failure', () => {
    const f = student()
    const body = accepted(DEPLOY, trialBodyFrom(DEPLOY, 'apply', applyReport(['ai'], f), deployInput()))
    expect(body.result).toEqual({
      ok: false,
      services: [
        { service: 'ai', ready: true, reason: null },
        { service: 'be', ready: false, reason: 'be: CrashLoopBackOff' },
        { service: 'fe', ready: false, reason: 'not applied' },
      ],
      pods: [{ metadata: { name: 'be-b-1' } }],
      events: [{ reason: 'BackOff' }],
      failure: { stage: 'apply', code: null, message: 'be: CrashLoopBackOff' },
    })
  })

  it('platform failure at apply (image pull): the code, the failed service, no k3s originals', () => {
    const body = accepted(DEPLOY, trialBodyFrom(DEPLOY, 'apply', applyReport(['ai'], platform('IMAGE_PULL_FAILED', 'be')), deployInput()))
    expect(body.result).toMatchObject({ pods: [], events: [], failure: { stage: 'apply', code: 'IMAGE_PULL_FAILED' } })
    expect((body.result.services as { reason: string }[]).map((s) => s.reason)).toEqual([null, 'GET pods did not answer in 10s', 'not applied'])
  })

  it('a failure without a service (the test Ingress) keeps the Ready services and marks the rest not applied', () => {
    const body = accepted(DEPLOY, trialBodyFrom(DEPLOY, 'apply', applyReport(['ai', 'be', 'fe'], platform('APPLY_REFUSED')), deployInput()))
    expect((body.result.services as { ready: boolean }[]).every((s) => s.ready)).toBe(true)
    expect(body.result.ok).toBe(false)
  })

  it('failure at prepare (quota, P2): no services, the cause in failure', () => {
    const f = student({ service: null, errorMessage: 'resources of both slots exceed the project quota: requests.cpu 5 > 4', raw: { pod: null, events: [], status: null } })
    const body = accepted(DEPLOY, trialBodyFrom(DEPLOY, 'prepare', { ok: false, slot: 'b', live: 'a', deleted: [], failure: f }, deployInput()))
    expect(body).toEqual({
      stage: 'prepare',
      result: { ok: false, services: [], pods: [], events: [], failure: { stage: 'prepare', code: null, message: 'resources of both slots exceed the project quota: requests.cpu 5 > 4' } },
    })
  })

  it('LIVE_SLOT_PROTECTED at prepare goes as that code (the gateway turns it into its refusal)', () => {
    const body = accepted(DEPLOY, trialBodyFrom(DEPLOY, 'prepare', { ok: false, failure: platform('LIVE_SLOT_PROTECTED') }, deployInput()))
    expect(body.result.failure).toMatchObject({ stage: 'prepare', code: 'LIVE_SLOT_PROTECTED' })
  })

  it('student failure at render: the Status message in failure, the Status itself is not sent (no status field in run_deploy)', () => {
    const status = { kind: 'Status', code: 422, message: 'Service "be-b" is invalid' }
    const f = student({ errorMessage: status.message, raw: { pod: null, events: [], status } })
    const body = accepted(DEPLOY, trialBodyFrom(DEPLOY, 'render', { ok: false, failure: f }, deployInput()))
    expect(body.result).toEqual({ ok: false, services: [], pods: [], events: [], failure: { stage: 'render', code: null, message: status.message } })
  })

  it('refuses an apply report without a list of service names', () => {
    expect(() => trialBodyFrom(DEPLOY, 'apply', { ok: true, failure: null, ready: 'ai' }, deployInput())).toThrow('apply report: has no ready list of service names')
  })
})

describe('run_verify', () => {
  const ready = [
    { service: 'be', ready: true },
    { service: 'fe', ready: true },
  ]

  it('passed: the Ready checks and requests as Verify wrote them', () => {
    const requests = [{ service: 'fe', path: '/', status: 200, ms: 12, error: null }]
    const body = accepted(VERIFY, trialBodyFrom(VERIFY, 'verify', { ok: true, slot: 'b', ready, requests, failure: null }, deployInput()))
    expect(body).toEqual({ stage: 'verify', result: { ok: true, ready, requests, failure: null } })
  })

  it('student failure: the failed check sentence (cases V1 · V2 read it)', () => {
    const requests = [{ service: 'fe', path: '/assets/index-abc.js', status: 404, ms: 3, error: null }]
    const f = student({ service: 'fe', errorMessage: 'fe: GET /assets/index-abc.js -> 404' })
    const body = accepted(VERIFY, trialBodyFrom(VERIFY, 'verify', { ok: false, slot: 'b', ready, requests, failure: f }, deployInput()))
    expect(body.result).toEqual({ ok: false, ready, requests, failure: { stage: 'verify', code: null, message: 'fe: GET /assets/index-abc.js -> 404' } })
  })

  it('platform failure (Traefik unreachable)', () => {
    const body = accepted(VERIFY, trialBodyFrom(VERIFY, 'verify', { ok: false, ready, requests: [], failure: platform('TRAEFIK_UNREACHABLE') }, deployInput()))
    expect(body.result.failure).toMatchObject({ code: 'TRAEFIK_UNREACHABLE' })
  })

  it('refuses a report without the lists', () => {
    expect(() => trialBodyFrom(VERIFY, 'verify', { ok: true, failure: null }, deployInput())).toThrow('verify report: has no ready and requests lists')
  })
})

describe('run_build', () => {
  // run_build의 입력: 그 서비스(be)만 run, 나머지는 reuse.
  const trialInput = (): DeployInput => {
    const input = deployInput()
    input.deploy_condition.services.fe = { ...input.deploy_condition.services.fe, build: 'reuse', image: digest('1') }
    return input
  }
  const built = (): DeployInput => {
    const input = trialInput()
    input.deploy_condition.services.be.image = digest('2')
    return input
  }
  const buildFailed = (over: Partial<Extract<BuildFailure, { kind: 'build' }>> = {}): BuildFailure => ({
    service: 'be',
    kind: 'build',
    buildStatus: 'FAILED',
    failedPhase: { phaseType: 'BUILD', phaseStatus: 'FAILED', contexts: [{ message: 'Error while executing command: pnpm run build' }] },
    logTail: ['> vite build', 'error TS2304'],
    build: { id: 'cb:be', buildStatus: 'FAILED' },
    ...over,
  })
  const report = (input: DeployInput, failures: BuildFailure[]): BuildReport => ({ ok: failures.length === 0, input, builds: { be: 'cb:be' }, failures })

  it('passed: the digest of the built service, not reused, no build original or log', () => {
    const body = accepted(BUILD, trialBodyFrom(BUILD, 'build', report(built(), []), trialInput(), now))
    expect(body).toEqual({ stage: 'build', result: { ok: true, reused: false, build: null, failedPhase: null, logTail: [], image: digest('2'), failure: null } })
  })

  it('build failure: the CodeBuild original, the phaseType, the log tail and the notify sentence', () => {
    const body = accepted(BUILD, trialBodyFrom(BUILD, 'build', report(trialInput(), [buildFailed()]), trialInput(), now))
    expect(body.result).toEqual({
      ok: false,
      reused: false,
      build: { id: 'cb:be', buildStatus: 'FAILED' },
      failedPhase: 'BUILD',
      logTail: ['> vite build', 'error TS2304'],
      image: null,
      failure: { stage: 'build', code: null, message: 'build FAILED in BUILD: Error while executing command: pnpm run build' },
    })
  })

  it('build failure without a phase or a readable log: failedPhase null, logTail []', () => {
    const body = accepted(BUILD, trialBodyFrom(BUILD, 'build', report(trialInput(), [buildFailed({ failedPhase: null, logTail: null })]), trialInput(), now))
    expect(body.result).toMatchObject({ failedPhase: null, logTail: [], failure: { message: 'build FAILED' } })
  })

  it('platform failure: the code and nothing of CodeBuild', () => {
    const f: BuildFailure = { service: 'be', kind: 'platform', code: 'BUILD_WAIT_TIMEOUT', message: 'build did not finish in 25 minutes' }
    const body = accepted(BUILD, trialBodyFrom(BUILD, 'build', report(trialInput(), [f]), trialInput(), now))
    expect(body.result).toEqual({
      ok: false,
      reused: false,
      build: null,
      failedPhase: null,
      logTail: [],
      image: null,
      failure: { stage: 'build', code: 'BUILD_WAIT_TIMEOUT', message: 'build did not finish in 25 minutes' },
    })
  })

  it.each([
    ['no service to build', () => builtDeployInputAllReuse(), 0],
    ['two services to build', () => builtDeployInput(), 2],
  ])('%s is a platform problem TRIAL_INPUT_INVALID (BE answers a reuse itself)', (_, input, n) => {
    const body = accepted(BUILD, trialBodyFrom(BUILD, 'build', { ok: true, input: input(), builds: {}, failures: [] }, deployInput(), now))
    expect(body.result).toMatchObject({ ok: false, image: null, failure: { stage: 'build', code: 'TRIAL_INPUT_INVALID' } })
    expect(body.result.failure!.message).toContain(`the input has ${n} to build`)
  })

  it('refuses a report whose ok does not match its failures, or ok without a digest', () => {
    expect(() => trialBodyFrom(BUILD, 'build', { ...report(trialInput(), [buildFailed()]), ok: true }, trialInput())).toThrow('build report: is ok but lists a failure')
    expect(() => trialBodyFrom(BUILD, 'build', { ...report(trialInput(), []), ok: false }, trialInput())).toThrow('is not ok but lists no failure of the built service')
    expect(() => trialBodyFrom(BUILD, 'build', report(trialInput(), []), trialInput())).toThrow('service be was built but has no image digest')
    expect(() => trialBodyFrom(BUILD, 'build', { ok: true, failures: [] }, trialInput())).toThrow('build report: has no input')
  })
})

function builtDeployInputAllReuse(): DeployInput {
  const input = builtDeployInput()
  for (const c of Object.values(input.deploy_condition.services)) c.build = 'reuse'
  return input
}

describe('noReportBody', () => {
  it.each([
    [RENDER, 'render', { status: null }],
    [DEPLOY, 'apply', { services: [], pods: [], events: [] }],
    [VERIFY, 'verify', { ready: [], requests: [] }],
    [BUILD, 'build', { reused: false, build: null, failedPhase: null, logTail: [], image: null }],
  ] as const)('%j at %s: STAGE_NO_REPORT with the empty fields of the tool', (trial, stage, fields) => {
    const body = accepted(trial, noReportBody(trial, stage, 'apply report: has no boolean ok'))
    expect(body).toEqual({ stage, result: { ok: false, ...fields, failure: { stage, code: 'STAGE_NO_REPORT', message: `the ${stage} stage left no readable report: apply report: has no boolean ok` } } })
  })

  it('a STAGE_NO_REPORT at a middle stage of run_deploy is still accepted (a failure may come from any stage of the tool)', () => {
    accepted(DEPLOY, noReportBody(DEPLOY, 'prepare'))
  })
})

describe('sendTrialResult', () => {
  let p: Awaited<ReturnType<typeof fakePlatform>> | undefined
  afterEach(async () => {
    await p?.close()
    p = undefined
  })
  const body = noReportBody(RENDER, 'render')

  it('posts the body to the trial with the token', async () => {
    p = await fakePlatform(() => ({ status: 200, body: { ok: true } }))
    expect(await sendTrialResult({ url: new URL(p.url), token: TOKEN }, 'tr_0123456789ab', body, () => Promise.resolve())).toEqual({ applied: true })
    expect(p.seen[0]).toMatchObject({ method: 'POST', url: '/api/pipeline/trials/tr_0123456789ab/result' })
    expect(p.seen[0].headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(JSON.parse(p.seen[0].body)).toEqual(body)
  })

  it('reads applied: false of a late result', async () => {
    p = await fakePlatform(() => ({ status: 200, body: { ok: true, applied: false } }))
    expect(await sendTrialResult({ url: new URL(p.url), token: TOKEN }, 'tr_0123456789ab', body, () => Promise.resolve())).toEqual({ applied: false })
  })
})
