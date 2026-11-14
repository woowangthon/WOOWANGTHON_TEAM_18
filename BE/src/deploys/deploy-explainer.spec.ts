import { Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { validSpec } from '../../test/spec-fixture.js'
import type { Env } from '../config/env.js'
import { DeployEvents } from './deploy-events.js'
import { DeployExplainer, explainRequest, type FailureMaterial, materialOf, maskInternal, parseExplanation } from './deploy-explainer.js'
import type { DeployRunRow, DeploysStore } from './deploys.store.js'

const SECRET_LINE = `DATABASE_URL=postgres://u:hunter2@h/db token=ghp_${'a'.repeat(36)}`
const input = (): Record<string, unknown> => ({
  commitSha: '0123456789abcdef0123456789abcdef01234567',
  spec: validSpec(),
  deploy_condition: {
    secretHash: null,
    services: {
      fe: { buildInputHash: 'sha256:a', build: 'run', image: null },
      be: { buildInputHash: 'sha256:b', build: 'reuse', image: 'ghcr.io/x/y@sha256:d' },
    },
  },
})
const run = (over: Partial<DeployRunRow> = {}): DeployRunRow =>
  ({ deploy_id: 'd1', user_id: 'u1', slug: 'my-app', target_slot: 'a', input: input(), status: 'succeeded', stage: null, failure: null, ticket_id: null, agent_result: null, ...over }) as DeployRunRow
const failedRun = (over: Partial<DeployRunRow> = {}) => run({ status: 'failed', stage: 'build', failure: { code: 'BUILD_FAILED', stage: 'build', service: 'fe' }, ticket_id: 't_1', ...over })
const material = (over: Partial<FailureMaterial> = {}): FailureMaterial => ({ errorMessage: 'build failed', logs: ['a'], pods: [], events: [], renderStatus: null, ...over })

describe('maskInternal', () => {
  it.each([
    ['100.101.1.2', 'at 100.101.1.2 down'],
    ['10.0.0.5:6443', 'dial 10.0.0.5:6443 refused'],
    ['svc.cluster.local', 'be.proj-x.svc.cluster.local lookup'],
    ['ts.net', 'node1.tail1234.ts.net unreachable'],
    ['arn', 'role arn:aws:iam::123456789012:role/deploy denied'],
    ['ecr', 'pull 123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/app:1 failed'],
    ['ghcr', 'pull ghcr.io/org/img@sha256:' + 'a'.repeat(64) + ' failed'],
    ['namespace', 'namespace proj-my-app missing'],
    ['label', 'label app.kubernetes.io/name=x'],
  ])('hides %s', (_n, text) => {
    const out = maskInternal(text)
    expect(out).toContain('[internal]')
    for (const leak of ['100.101.1.2', '10.0.0.5', 'cluster.local', 'ts.net', 'arn:aws', 'dkr.ecr', 'ghcr.io', 'proj-my-app', 'kubernetes.io']) expect(out).not.toContain(leak)
  })

  it('keeps ordinary text', () => {
    expect(maskInternal('Error: listen EADDRINUSE :::3000')).toBe('Error: listen EADDRINUSE :::3000')
    expect(maskInternal('GET /api/health 200')).toBe('GET /api/health 200')
  })
})

const ticket = () => ({
  errorMessage: 'boom',
  logs: { from: 'a', to: 'b', lines: ['line1', 'line2'] },
  raw: {
    k8s: {
      pod: {
        metadata: { name: 'pod-xyz', labels: { secretlabel: 'L' } },
        spec: { nodeName: 'node-secret-1', containers: [{ env: [{ name: 'FOO', value: 'envvalue-secret' }] }] },
        status: {
          containerStatuses: [{ name: 'app', restartCount: 4, state: { waiting: { reason: 'CrashLoopBackOff' } }, lastState: { terminated: { reason: 'Error', exitCode: 137 } } }],
        },
      },
      events: [...Array.from({ length: 12 }, (_, i) => ({ reason: `R${i}`, message: `m${i}` })), { reason: 'R11', message: 'm11' }],
      status: { reason: 'Invalid', message: 'bad render', details: { causes: [{ message: 'cause one' }] } },
    },
    codebuild: { buildId: 'CB-SECRET-RAW' },
  },
})

describe('materialOf', () => {
  it('summarizes containers, events, render status and logs', () => {
    const m = materialOf(ticket())
    expect(m.errorMessage).toBe('boom')
    expect(m.logs).toEqual(['line1', 'line2'])
    expect(m.pods).toHaveLength(1)
    expect(m.pods[0]).toContain('app')
    expect(m.pods[0]).toContain('CrashLoopBackOff')
    expect(m.pods[0]).toContain('restarts 4')
    expect(m.pods[0]).toContain('last exit 137')
    expect(m.renderStatus).toContain('Invalid: bad render')
    expect(m.renderStatus).toContain('cause one')
  })

  it('does not carry pod metadata or spec, nor CodeBuild raw content', () => {
    const json = JSON.stringify(materialOf(ticket()))
    for (const leak of ['node-secret-1', 'envvalue-secret', 'pod-xyz', 'secretlabel', 'CB-SECRET-RAW']) expect(json).not.toContain(leak)
  })

  it('dedupes events and keeps the last 10', () => {
    const { events } = materialOf(ticket())
    expect(events).toHaveLength(10)
    expect(events.at(-1)).toBe('R11: m11')
    expect(new Set(events).size).toBe(10)
  })

  it('gives empty pods and events for a build ticket', () => {
    const m = materialOf({ errorMessage: 'x', logs: { lines: ['l'] }, raw: { k8s: null, codebuild: { buildId: 'CB-SECRET-RAW' } } })
    expect(m).toEqual({ errorMessage: 'x', logs: ['l'], pods: [], events: [], renderStatus: null })
    expect(JSON.stringify(m)).not.toContain('CB-SECRET-RAW')
  })
})

describe('explainRequest', () => {
  it('describes a succeeded run without evidence, env values or secret names', () => {
    const r = run()
    const inp = r.input as { spec: { services: { runtime: { env: Record<string, string>; secretKeys: string[] } }[] } }
    inp.spec.services[0].runtime.env = { API_URL: 'https://env-value-leak.example' }
    inp.spec.services[1].runtime.env = {}
    inp.spec.services[1].runtime.secretKeys = ['MY_SECRET_KEY_NAME', 'OTHER']
    const body = explainRequest(r, undefined, undefined)!
    expect(body).toMatchObject({ outcome: 'succeeded', failure: null, evidence: null, firstDeploy: null })
    const services = body.services as Record<string, unknown>[]
    expect(services[0]).toMatchObject({ name: 'fe', port: 8080, ingressPath: '/', health: { type: 'http', path: '/' }, build: 'run', envCount: 1, secretCount: 0 })
    expect(services[1]).toMatchObject({ name: 'be', port: 3000, build: 'reuse', envCount: 0, secretCount: 2 })
    const json = JSON.stringify(body)
    for (const leak of ['env-value-leak', 'MY_SECRET_KEY_NAME', 'OTHER']) expect(json).not.toContain(leak)
    expect(explainRequest(r, undefined, true)!.firstDeploy).toBe(true)
    expect(explainRequest(r, undefined, false)!.firstDeploy).toBe(false)
  })

  it('builds evidence for a student failure, redacting secrets and masking internals', () => {
    const body = explainRequest(failedRun(), material({ errorMessage: SECRET_LINE, logs: ['at 10.0.0.5:6443 failed', SECRET_LINE], pods: ['app: waiting · proj-my-app'] }), undefined)!
    expect(body.outcome).toBe('failed')
    expect(body.failure).toMatchObject({ code: 'BUILD_FAILED', stage: 'build', service: 'fe' })
    const json = JSON.stringify(body)
    for (const leak of ['hunter2', 'ghp_' + 'a'.repeat(36), '10.0.0.5', 'proj-my-app']) expect(json).not.toContain(leak)
    expect((body.evidence as { logs: string[] }).logs[0]).toContain('[internal]')
  })

  it('has no evidence when the material is missing', () => {
    expect(explainRequest(failedRun(), undefined, undefined)!.evidence).toBeNull()
  })

  it('returns null for runs that are not explained', () => {
    expect(explainRequest(failedRun({ ticket_id: null }), material(), undefined)).toBeNull()
    expect(explainRequest(failedRun({ failure: { code: 'IMAGE_PULL_FAILED', stage: 'apply', service: null } }), material(), undefined)).toBeNull()
    for (const status of ['running', 'fixing', 'queued'] as const) expect(explainRequest(run({ status }), undefined, undefined)).toBeNull()
  })

  it('skips a failure the AI server did not take (AGENT_UNAVAILABLE)', () => {
    expect(explainRequest(failedRun({ failure: { code: 'AGENT_UNAVAILABLE', stage: 'apply', service: 'be' } }), material(), undefined)).toBeNull()
  })

  it('keeps student-chosen service names and paths that look like internal names', () => {
    const r = failedRun({ failure: { code: 'VERIFY_FAILED', stage: 'verify', service: 'proj-web' } })
    const inp = r.input as { spec: { services: { name: string; runtime: { ingressPath: string | null } }[] } }
    inp.spec.services[0].name = 'proj-web'
    inp.spec.services[0].runtime.ingressPath = '/proj-web'
    const body = explainRequest(r, material({ logs: ['namespace proj-my-app missing'] }), undefined)!
    expect((body.services as { name: string; ingressPath: string }[])[0]).toMatchObject({ name: 'proj-web', ingressPath: '/proj-web' })
    expect((body.failure as { service: string }).service).toBe('proj-web')
    expect((body.evidence as { logs: string[] }).logs[0]).toBe('namespace [internal] missing')
  })

  it('explains needs_user with the agent summary and evidence, masked', () => {
    const r = failedRun({
      status: 'needs_user',
      failure: { code: 'VERIFY_FAILED', stage: 'verify', service: 'be' },
      agent_result: { status: 'needs_user', summary: 'host be.proj-x.svc.cluster.local down', evidence: [{ ref: 'log', text: 'ip 100.101.1.2' }] },
    })
    const body = explainRequest(r, material(), undefined)!
    const agent = body.agent as { summary: string; evidence: string[] }
    expect(agent.summary).toContain('[internal]')
    expect(agent.evidence[0]).toBe('log: ip [internal]')
    expect(JSON.stringify(body)).not.toContain('cluster.local')
  })
})

describe('parseExplanation', () => {
  const valid = () => ({
    summary: 's',
    steps: [{ stage: 'build', did: 'd', meaning: 'm' }],
    cause: 'c',
    actions: ['a'],
    terms: [{ term: 't', meaning: 'm' }],
  })

  it('passes a valid answer through', () => {
    expect(parseExplanation(valid())).toEqual(valid())
    expect(parseExplanation({ ...valid(), cause: null })!.cause).toBeNull()
  })

  it('clips lengths and counts', () => {
    const long = 'x'.repeat(500)
    const out = parseExplanation({
      summary: long,
      steps: Array.from({ length: 9 }, () => ({ stage: 'build', did: long, meaning: long })),
      cause: long,
      actions: Array.from({ length: 9 }, () => long),
      terms: Array.from({ length: 9 }, () => ({ term: long, meaning: long })),
    })!
    expect(out.summary).toHaveLength(300)
    expect(out.cause).toHaveLength(300)
    expect(out.steps).toHaveLength(6)
    expect(out.steps[0].did).toHaveLength(300)
    expect(out.steps[0].meaning).toHaveLength(300)
    expect(out.actions).toHaveLength(5)
    expect(out.actions[0]).toHaveLength(200)
    expect(out.terms).toHaveLength(5)
    expect(out.terms[0].term).toHaveLength(40)
    expect(out.terms[0].meaning).toHaveLength(200)
  })

  it('drops steps with an unknown stage', () => {
    const out = parseExplanation({ ...valid(), steps: [{ stage: 'nope', did: 'd', meaning: 'm' }, { stage: 'verify', did: 'd', meaning: 'm' }] })!
    expect(out.steps.map((s) => s.stage)).toEqual(['verify'])
  })

  it.each([null, 'x', 5, [], { ...{ summary: 's' } }, { summary: 's', steps: [], actions: [] }, { summary: 's', steps: [], actions: [], terms: [], cause: 5 }, { steps: [], actions: [], terms: [], cause: null }])(
    'rejects a bad shape %#',
    (v) => {
      expect(parseExplanation(v)).toBeNull()
    },
  )

  it('masks secrets and internal names in the answer', () => {
    const out = parseExplanation({ ...valid(), summary: SECRET_LINE, cause: 'node 100.101.1.2', actions: ['ns proj-my-app'] })!
    expect(out.summary).not.toContain('hunter2')
    expect(out.summary).not.toContain('ghp_')
    expect(out.cause).toBe('node [internal]')
    expect(out.actions[0]).toBe('ns [internal]')
  })
})

describe('DeployExplainer', () => {
  const AI = 'https://ai.test'
  const TOKEN = 'agent_token_secret_zzz'
  let events: DeployEvents
  let findRun: ReturnType<typeof vi.fn>
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
  let warn: MockInstance<Logger['warn']>
  const answer = { summary: 's', steps: [], cause: null, actions: [], terms: [] }

  const make = (over: Record<string, unknown> = {}) => {
    const conf: Record<string, unknown> = { DEPLOY_EXPLAIN_ENABLED: true, AI_SERVER_URL: AI, AGENT_API_TOKEN: TOKEN, ...over }
    const explainer = new DeployExplainer({ get: (k: string) => conf[k] } as unknown as ConfigService<Env, true>, events, { findRun } as unknown as DeploysStore)
    explainer.onModuleInit()
    return explainer
  }
  const settle = () => new Promise((r) => setTimeout(r, 0))

  beforeEach(() => {
    events = new DeployEvents()
    findRun = vi.fn(() => Promise.resolve(run()))
    fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(answer)))
    vi.stubGlobal('fetch', fetchMock)
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does nothing when disabled', async () => {
    const ex = make({ DEPLOY_EXPLAIN_ENABLED: false })
    events.ended('d1')
    ex.rememberTicket('d1', ticket())
    ex.rememberSuccess('d1', true)
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(findRun).not.toHaveBeenCalled()
    expect(ex.read('d1')).toBeNull()
  })

  it('is pending at once, then ready with the content; posts to the AI server with the bearer token', async () => {
    const ex = make()
    events.ended('d1')
    expect(ex.read('d1')).toEqual({ state: 'pending', content: null })
    await settle()
    expect(ex.read('d1')).toEqual({ state: 'ready', content: answer })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://ai.test/agent/explanations')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toMatchObject({ deployId: 'd1', outcome: 'succeeded' })
  })

  it('fails when the AI server answers 503', async () => {
    fetchMock.mockResolvedValue(Response.json({}, { status: 503 }))
    const ex = make()
    events.ended('d1')
    await settle()
    expect(ex.read('d1')).toEqual({ state: 'failed', content: null })
  })

  it('fails when the answer has the wrong shape', async () => {
    fetchMock.mockResolvedValue(Response.json({ nope: 1 }))
    const ex = make()
    events.ended('d1')
    await settle()
    expect(ex.read('d1')?.state).toBe('failed')
  })

  it('fails (and does not throw) when fetch throws; the log has no token', async () => {
    fetchMock.mockRejectedValue(new Error(`connect ${TOKEN}`))
    const ex = make()
    events.ended('d1')
    await settle()
    expect(ex.read('d1')).toEqual({ state: 'failed', content: null })
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN)
  })

  it('fails when findRun throws', async () => {
    findRun.mockRejectedValue(new Error('db down'))
    const ex = make()
    events.ended('d1')
    await settle()
    expect(ex.read('d1')).toEqual({ state: 'failed', content: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips a platform failure without calling the AI server', async () => {
    findRun.mockResolvedValue(failedRun({ failure: { code: 'IMAGE_PULL_FAILED', stage: 'apply', service: null } }))
    const ex = make()
    events.ended('d1')
    await settle()
    expect(ex.read('d1')).toEqual({ state: 'skipped', content: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails without a fetch when AI_SERVER_URL is not set', async () => {
    const ex = make({ AI_SERVER_URL: undefined })
    events.ended('d1')
    await settle()
    expect(ex.read('d1')?.state).toBe('failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the remembered ticket material, redacted, and drops it after explaining', async () => {
    findRun.mockResolvedValue(failedRun())
    const ex = make()
    ex.rememberTicket('d1', { errorMessage: SECRET_LINE, logs: { lines: ['unique-log-line'] }, raw: { k8s: null } })
    await ex.explain('d1')
    const first = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as { evidence: { logs: string[] } | null }
    expect(first.evidence?.logs).toEqual(['unique-log-line'])
    expect(JSON.stringify(first)).not.toContain('hunter2')
    await ex.explain('d1')
    const second = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as { evidence: unknown }
    expect(second.evidence).toBeNull()
  })

  it('keeps the first firstDeploy when the switch notice comes again', async () => {
    const ex = make()
    ex.rememberSuccess('d1', true)
    ex.rememberSuccess('d1', false)
    await ex.explain('d1')
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ firstDeploy: true })
  })

  it('sends no evidence after forgetTicket (AGENT_GAVE_UP without a new ticket)', async () => {
    findRun.mockResolvedValue(failedRun({ failure: { code: 'AGENT_GAVE_UP', stage: 'verify', service: 'be' } }))
    const ex = make()
    ex.rememberTicket('d1', { errorMessage: 'old error', logs: { lines: ['old-log-line'] }, raw: { k8s: null } })
    ex.forgetTicket('d1')
    await ex.explain('d1')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as { evidence: unknown }
    expect(body.evidence).toBeNull()
  })

  it('passes firstDeploy from rememberSuccess', async () => {
    const ex = make()
    ex.rememberSuccess('d1', true)
    await ex.explain('d1')
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ firstDeploy: true })
  })

  it('keeps at most 200 entries, dropping the oldest', async () => {
    const ex = make()
    for (let i = 0; i < 201; i++) events.ended(`d${i}`)
    expect(ex.read('d0')).toBeNull()
    expect(ex.read('d1')).not.toBeNull()
    expect(ex.read('d200')).not.toBeNull()
    await settle()
  })
})
