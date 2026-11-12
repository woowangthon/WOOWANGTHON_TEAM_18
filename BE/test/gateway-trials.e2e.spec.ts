import type { INestApplication } from '@nestjs/common'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DeployRunRow } from '../src/deploys/deploys.store.js'
import { DeploysStore } from '../src/deploys/deploys.store.js'
import { AgentClient } from '../src/deploys/agent.client.js'
import { PipelineClient } from '../src/deploys/pipeline.client.js'
import { GatewayServer } from '../src/gateway/gateway.server.js'
import { RepoReader } from '../src/gateway/repo-reader.js'
import { tokenHash } from '../src/gateway/tickets.js'
import { GatewayTrials } from '../src/gateway/trials.js'
import { ClusterReader } from '../src/k8s/cluster-reader.js'
import { validSpec } from './spec-fixture.js'
import { startApp } from './start-app.js'

// 시험 실행(api.md "파이프라인 ↔ 플랫폼 서버" 4번): 실제 HTTP 위의 MCP 클라이언트 → 게이트웨이 → 가짜 GoCD → 파이프라인처럼 입력 읽기 · 결과 보내기.

const SHA = '0123456789abcdef0123456789abcdef01234567'
const DEPLOY = '44444444-4444-4444-8444-444444444444'
const TOKEN = `gw_${'t'.repeat(32)}`
const NOTIFY = process.env.PIPELINE_NOTIFY_TOKEN ?? ''
const SECRET = `ghp_${'s'.repeat(36)}`
const FE_IMAGE = `ghcr.io/woowang-bot/student-apps@sha256:${'f'.repeat(64)}`
const BE_IMAGE = `ghcr.io/woowang-bot/student-apps@sha256:${'e'.repeat(64)}`
const HASH = (c: string) => `sha256:${c.repeat(64)}`

let run: DeployRunRow
let live: DeployRunRow | undefined
const expiries: string[] = []
const fakeStore = {
  findRunByGatewayToken: (hash: string) => Promise.resolve(hash === run.gateway_token_hash ? run : undefined),
  findById: (id: string) => Promise.resolve(id === DEPLOY ? { id, repo: 'student/my-app', slug: 'my-app' } : undefined),
  findRun: (id: string) => Promise.resolve(id === DEPLOY ? run : undefined),
  findLastSucceededRun: () => Promise.resolve(live),
  updateRun: (_id: string, where: { status?: string }, patch: Record<string, unknown>) => {
    if (where.status && run.status !== where.status) return Promise.resolve(false)
    if (typeof patch.gateway_expires_at === 'string') expiries.push(patch.gateway_expires_at)
    Object.assign(run, patch)
    return Promise.resolve(true)
  },
}

// 가짜 GoCD: 실행 요청을 기록하고, 테스트가 정한 대로 파이프라인 job처럼 입력을 읽고 결과를 보낸다.
type Behave = (trialId: string, stages: string) => Promise<void>
let scheduled: { deployId: string; trialId: string; stages: string }[]
let behave: Behave
let scheduleFails: boolean
let cancelOk: boolean
let reruns: string[]
let rerunFails: boolean
const fakePipeline = {
  runTrial(deployId: string, trialId: string, stages: string) {
    if (scheduleFails) return Promise.reject(new Error('GoCD down'))
    scheduled.push({ deployId, trialId, stages })
    setImmediate(() => void behave(trialId, stages))
    return Promise.resolve()
  },
  cancelTrial: () => Promise.resolve(cancelOk),
  cancelAllTrials: () => Promise.resolve(0),
  run(deployId: string) {
    if (rerunFails) return Promise.reject(new Error('GoCD down'))
    reruns.push(deployId)
    return Promise.resolve()
  },
}
// 가짜 AI 서버: 종료 알림만 기록한다.
let closes: unknown[][]
const fakeAgent = {
  close: (...args: unknown[]) => {
    closes.push(args)
    return Promise.resolve(true)
  },
}

let app: INestApplication<App>
let url: string
const readInputs: Record<string, unknown>[] = []

const auth = { Authorization: `Bearer ${NOTIFY}` }
const readInput = async (trialId: string) => {
  const res = await request(app.getHttpServer()).get(`/api/pipeline/trials/${trialId}/input?counter=42`).set(auth)
  readInputs.push(res.body as Record<string, unknown>)
  return res
}
const postResult = (trialId: string, body: unknown) => request(app.getHttpServer()).post(`/api/pipeline/trials/${trialId}/result`).set(auth).send(body as object)
/** 파이프라인: 입력을 읽고 그 도구 모양의 결과를 보낸다. */
const answering =
  (stage: string, result: Record<string, unknown>): Behave =>
  async (trialId) => {
    await readInput(trialId)
    await postResult(trialId, { stage, result })
  }

const deployOk = {
  ok: true,
  services: [
    { service: 'fe', ready: true, reason: null },
    { service: 'be', ready: true, reason: null },
  ],
  pods: [{ metadata: { name: 'be-b-1' }, spec: { containers: [{ env: [{ name: 'TOKEN', value: SECRET }] }] } }],
  events: [],
  failure: null,
}
const verifyOk = { ok: true, ready: [{ service: 'fe', ready: true }, { service: 'be', ready: true }], requests: [{ service: 'be', path: '/api/health', status: 200, ms: 9, error: null }], failure: null }

beforeEach(async () => {
  run = {
    deploy_id: DEPLOY,
    user_id: 'u',
    slug: 'my-app',
    target_slot: 'b',
    input: {
      commitSha: SHA,
      deploy_condition: { services: { fe: { buildInputHash: HASH('a'), build: 'reuse', image: FE_IMAGE }, be: { buildInputHash: HASH('b'), build: 'run', image: null } } },
      spec: validSpec(),
    },
    status: 'fixing',
    stage: 'verify',
    failure: { code: 'VERIFY_FAILED', stage: 'verify', service: 'be' },
    ticket_id: 't_trial',
    gateway_token_hash: tokenHash(TOKEN),
    gateway_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    images: { be: BE_IMAGE },
    created_at: '2026-11-11T00:00:00Z',
    // 이 프로세스가 방금 낸 티켓(티켓 시작 = 만료 - 15분).
    updated_at: new Date().toISOString(),
  }
  live = undefined
  expiries.length = 0
  readInputs.length = 0
  scheduled = []
  scheduleFails = false
  cancelOk = true
  reruns = []
  rerunFails = false
  closes = []
  behave = answering('apply', deployOk)
  app = await startApp([], (b) =>
    b
      .overrideProvider(DeploysStore)
      .useValue(fakeStore)
      .overrideProvider(PipelineClient)
      .useValue(fakePipeline)
      .overrideProvider(ClusterReader)
      .useValue({})
      .overrideProvider(RepoReader)
      .useValue({})
      .overrideProvider(AgentClient)
      .useValue(fakeAgent),
  )
  app.get(GatewayTrials).settleRetryMs = 10
  const port = await app.get(GatewayServer).listen(0, '127.0.0.1')
  url = `http://127.0.0.1:${port}/mcp`
})

afterEach(async () => {
  await app.close()
})

async function connect(): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }))
  return client
}
interface Answer {
  isError?: boolean
  structuredContent?: Record<string, unknown>
}
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as Answer
const rejected = (a: Answer) => (a.isError ? (a.structuredContent as { code: string; message: string }) : null)
const port8000 = [{ op: 'replace', path: '/spec/services/1/runtime/port', value: 8000 }]
const specOf = (input: unknown) => (input as { spec: { services: { runtime: Record<string, unknown> }[] } }).spec

describe('MCP gateway trial tools', () => {
  it('runs run_deploy on student-trial with the patched input (all reuse, slot b) and answers the masked result', async () => {
    const client = await connect()
    const answer = await call(client, 'run_deploy', { specPatch: port8000 })
    expect(rejected(answer)).toBeNull()
    expect(scheduled).toEqual([{ deployId: DEPLOY, trialId: expect.stringMatching(/^tr_[0-9a-f]{12}$/) as string, stages: 'prepare,render,apply' }])
    const read = readInputs[0] as { deployId: string; slot: string; input: Record<string, unknown>; buildOverrides: unknown }
    expect(read).toMatchObject({ deployId: DEPLOY, slot: 'b', buildOverrides: null })
    expect(specOf(read.input).services[1].runtime.port).toBe(8000)
    // 빌드한 be는 이번 실행의 이미지로, fe는 원래 reuse 이미지로. 모두 reuse라 Build가 할 일이 없다.
    expect(read.input.deploy_condition).toEqual({
      services: { fe: { buildInputHash: HASH('a'), build: 'reuse', image: FE_IMAGE }, be: { buildInputHash: HASH('b'), build: 'reuse', image: BE_IMAGE } },
    })
    // DB의 실행 기록 입력은 그대로다.
    expect(specOf(run.input).services[1].runtime.port).toBe(3000)
    const content = answer.structuredContent!
    expect(content).toMatchObject({ ok: true, services: deployOk.services, failure: null })
    expect(JSON.stringify(content)).not.toContain(SECRET)
    await client.close()
  })

  it('raises the token expiry when the wait starts and writes it again when it ends', async () => {
    const before = Date.parse(run.gateway_expires_at!)
    behave = answering('render', { ok: true, status: null, failure: null })
    const client = await connect()
    await call(client, 'run_render', { specPatch: port8000 })
    expect(expiries).toHaveLength(2)
    // 시작 때: 지금 + 남은 15분 + 이번 대기 상한(30분) — 처음 만료보다 늦다. 끝날 때: 티켓 시작 + 15분 + 누적 대기.
    expect(Date.parse(expiries[0]) - before).toBeGreaterThan(29 * 60_000)
    expect(Date.parse(expiries[1])).toBeGreaterThanOrEqual(before)
    expect(Date.parse(expiries[1])).toBeLessThan(Date.parse(expiries[0]))
    await client.close()
  })

  it('does not run the trial when the ticket ended before the wait could start (the expiry could not be raised)', async () => {
    const client = await connect()
    // 토큰 확인 뒤, 만료를 늘리기 전에 티켓이 끝난다(다른 호출이 결과를 냈다).
    const lookup = fakeStore.findLastSucceededRun
    fakeStore.findLastSucceededRun = () => {
      run.status = 'needs_user'
      return Promise.resolve(undefined)
    }
    try {
      expect(rejected(await call(client, 'run_render'))).toMatchObject({ code: 'TICKET_CLOSED' })
    } finally {
      fakeStore.findLastSucceededRun = lookup
    }
    expect(scheduled).toEqual([])
    expect(expiries).toEqual([])
    await client.close()
  })

  it('does not extend past the stored expiry for a ticket the previous process handled (BE restarted)', async () => {
    run.updated_at = '2026-11-11T00:00:00Z'
    const before = Date.parse(run.gateway_expires_at!)
    behave = answering('render', { ok: true, status: null, failure: null })
    const client = await connect()
    await call(client, 'run_render')
    expect(expiries.map((e) => Date.parse(e))).toEqual([before, before])
    await client.close()
  })

  it('checks run_verify with the input of the last successful run_deploy', async () => {
    const client = await connect()
    await call(client, 'run_deploy', { specPatch: port8000 })
    behave = answering('verify', verifyOk)
    const answer = await call(client, 'run_verify')
    expect(answer.structuredContent).toEqual(verifyOk)
    expect(scheduled[1].stages).toBe('verify')
    expect(specOf((readInputs[1] as { input: unknown }).input).services[1].runtime.port).toBe(8000)
    await client.close()
  })

  it('turns a LIVE_SLOT_PROTECTED failure into a rejection (the agent stops)', async () => {
    behave = answering('prepare', { ok: false, services: [], pods: [], events: [], failure: { stage: 'prepare', code: 'LIVE_SLOT_PROTECTED', message: 'target slot b is live' } })
    const client = await connect()
    expect(rejected(await call(client, 'run_deploy'))).toMatchObject({ code: 'LIVE_SLOT_PROTECTED' })
    await client.close()
  })

  it('answers ok: false PIPELINE_UNAVAILABLE when GoCD does not take the trial', async () => {
    scheduleFails = true
    const client = await connect()
    expect((await call(client, 'run_render')).structuredContent).toEqual({ ok: false, status: null, failure: { stage: null, code: 'PIPELINE_UNAVAILABLE', message: expect.any(String) as string } })
    await client.close()
  })

  it('allows one trial at a time per ticket', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    behave = async (trialId) => {
      await readInput(trialId)
      await held
      await postResult(trialId, { stage: 'render', result: { ok: true, status: null, failure: null } })
    }
    const client = await connect()
    const first = call(client, 'run_render')
    while (scheduled.length === 0) await new Promise((r) => setTimeout(r, 5))
    expect(rejected(await call(client, 'run_deploy'))).toMatchObject({ code: 'INVALID_ARGUMENT' })
    release()
    expect((await first).structuredContent).toEqual({ ok: true, status: null, failure: null })
    await client.close()
  })

  it.each([
    ['a build path', [{ op: 'replace', path: '/spec/services/0/build/outputDir', value: 'build' }], 'PATCH_FORBIDDEN'],
    ['a service name', [{ op: 'replace', path: '/spec/services/0/name', value: 'web' }], 'PATCH_FORBIDDEN'],
    ['a value that breaks the spec rules', [{ op: 'replace', path: '/spec/services/1/runtime/port', value: 0 }], 'INVALID_SPEC'],
    ['a malformed patch', [{ op: 'copy', path: '/spec/services/1/runtime/port' }], 'INVALID_ARGUMENT'],
  ])('refuses %s before scheduling anything', async (_label, specPatch, code) => {
    const client = await connect()
    expect(rejected(await call(client, 'run_deploy', { specPatch }))).toMatchObject({ code })
    expect(scheduled).toEqual([])
    await client.close()
  })

  it('puts the INVALID_SPEC fields in their own field of the rejection', async () => {
    const client = await connect()
    const answer = await call(client, 'run_deploy', { specPatch: [{ op: 'replace', path: '/spec/services/1/runtime/port', value: 0 }] })
    expect(answer.structuredContent).toEqual({ code: 'INVALID_SPEC', message: expect.not.stringContaining('[') as string, fields: [{ path: 'services[1].runtime.port', code: 'OUT_OF_RANGE' }] })
    await client.close()
  })

  it('refuses a trial whose input already has another path than live for a stripPrefix service, even without a patch', async () => {
    const liveSpec = validSpec() as { services: { runtime: Record<string, unknown> }[] }
    liveSpec.services[1].runtime.stripPrefix = true
    live = { ...run, status: 'succeeded', input: { ...run.input, spec: liveSpec } }
    Object.assign((run.input.spec as typeof liveSpec).services[1].runtime, { stripPrefix: true, ingressPath: '/v2' })
    const client = await connect()
    expect(rejected(await call(client, 'run_render'))).toMatchObject({ code: 'PATCH_FORBIDDEN' })
    // live 경로로 되돌리는 수정안은 받는다.
    behave = answering('render', { ok: true, status: null, failure: null })
    expect(rejected(await call(client, 'run_render', { specPatch: [{ op: 'replace', path: '/spec/services/1/runtime/ingressPath', value: '/api' }] }))).toBeNull()
    expect(scheduled).toHaveLength(1)
    await client.close()
  })

  it('refuses changing the ingressPath of a service that strips its prefix on live', async () => {
    const liveSpec = validSpec() as { services: { runtime: Record<string, unknown> }[] }
    liveSpec.services[1].runtime.stripPrefix = true
    live = { ...run, status: 'succeeded', input: { ...run.input, spec: liveSpec } }
    ;(run.input.spec as typeof liveSpec).services[1].runtime.stripPrefix = true
    const client = await connect()
    const answer = await call(client, 'run_deploy', { specPatch: [{ op: 'replace', path: '/spec/services/1/runtime/ingressPath', value: '/v2' }] })
    expect(rejected(answer)).toMatchObject({ code: 'PATCH_FORBIDDEN' })
    expect(scheduled).toEqual([])
    // stripPrefix를 끄면서 바꾸는 것은 live에 닿지 않는다.
    const off = await call(client, 'run_deploy', {
      specPatch: [
        { op: 'replace', path: '/spec/services/1/runtime/stripPrefix', value: false },
        { op: 'replace', path: '/spec/services/1/runtime/ingressPath', value: '/v2' },
      ],
    })
    expect(rejected(off)).toBeNull()
    await client.close()
  })

  it('cannot try a build ticket: the service has no image yet', async () => {
    run.images = null
    const client = await connect()
    expect(rejected(await call(client, 'run_render'))?.message).toMatch(/no image yet/)
    expect(scheduled).toEqual([])
    await client.close()
  })

  describe('submit_result verified (api.md 5: re-run student-deploy with the checked input)', () => {
    const verified = (specPatch: unknown[], extra: Record<string, unknown> = {}) => ({
      result: {
        ticketId: 't_trial',
        commitSha: SHA,
        status: 'verified',
        classification: { method: 'code', caseId: 'V2', path: 'playbook' },
        actions: [{ tool: 'run_deploy', ok: true }, { tool: 'run_verify', ok: true }],
        specPatch,
        summary: 'be 포트를 8000으로 고쳐 대상 슬롯에서 확인했습니다',
        ...extra,
      },
    })
    /** run_deploy(패치) → run_verify 통과까지. */
    const tryAndVerify = async (client: Client, specPatch: unknown[] = port8000) => {
      behave = answering('apply', deployOk)
      expect((await call(client, 'run_deploy', { specPatch })).structuredContent).toMatchObject({ ok: true })
      behave = answering('verify', verifyOk)
      expect((await call(client, 'run_verify')).structuredContent).toMatchObject({ ok: true })
    }

    it('saves the checked input (all reuse + digest) on the run, re-runs student-deploy from build and keeps the ticket id', async () => {
      const client = await connect()
      await tryAndVerify(client)
      expect((await call(client, 'submit_result', verified(port8000))).structuredContent).toEqual({ accepted: true })
      expect(reruns).toEqual([DEPLOY])
      expect(run).toMatchObject({ status: 'running', stage: 'build', failure: null, gateway_token_hash: null, ticket_id: 't_trial' })
      expect(specOf(run.input).services[1].runtime.port).toBe(8000)
      expect(run.input.deploy_condition).toEqual({
        services: { fe: { buildInputHash: HASH('a'), build: 'reuse', image: FE_IMAGE }, be: { buildInputHash: HASH('b'), build: 'reuse', image: BE_IMAGE } },
      })
      // 다시 실행이 쓰는 입력은 확인한 run_deploy의 입력과 같다.
      expect(run.input).toEqual(readInputs[0].input)
      expect(run.agent_result).toMatchObject({ status: 'verified', summary: expect.any(String) as string, tickets: 1 })
      expect(closes).toEqual([])
      // 토큰은 끝났다.
      expect(rejected(await call(client, 'run_render'))).toMatchObject({ code: 'TICKET_CLOSED' })
      await client.close()
    })

    it('counts the ticket after the one the earlier verified result counted', async () => {
      run.agent_result = { status: 'verified', summary: 'x', tickets: 2 }
      const client = await connect()
      await tryAndVerify(client)
      await call(client, 'submit_result', verified(port8000))
      expect(run.agent_result).toMatchObject({ tickets: 3 })
      await client.close()
    })

    it('takes an empty specPatch after a plain re-run that passed', async () => {
      const client = await connect()
      await tryAndVerify(client, [])
      expect((await call(client, 'submit_result', verified([]))).structuredContent).toEqual({ accepted: true })
      expect(run).toMatchObject({ status: 'running', stage: 'build' })
      await client.close()
    })

    it.each([
      ['no trial at all', async () => {}],
      ['run_deploy without a passing run_verify', async (c: Client) => void (await call(c, 'run_deploy', { specPatch: port8000 }))],
      ['run_verify without a run_deploy (it checked the original input)', async (c: Client) => {
        behave = answering('verify', verifyOk)
        await call(c, 'run_verify')
      }],
      ['another run_deploy after the passing run_verify', async (c: Client) => {
        await tryAndVerify(c)
        behave = answering('apply', deployOk)
        await call(c, 'run_deploy', { specPatch: port8000 })
      }],
      // 두 번째 run_deploy가 실패하면 슬롯에는 그 배포가 반쯤 올라가 있다. 첫 입력의 확인을 되살리지 않는다.
      ['another run_deploy that failed, then a passing run_verify', async (c: Client) => {
        await tryAndVerify(c)
        behave = answering('apply', { ...deployOk, ok: false, failure: { stage: 'apply', code: null, message: 'pod be crashed' } })
        await call(c, 'run_deploy', { specPatch: port8000 })
        behave = answering('verify', verifyOk)
        expect((await call(c, 'run_verify')).structuredContent).toMatchObject({ ok: true })
      }],
      ['a run_verify that failed', async (c: Client) => {
        await call(c, 'run_deploy', { specPatch: port8000 })
        behave = answering('verify', { ok: false, ready: [], requests: [], failure: { stage: 'verify', code: null, message: 'GET /api/health 502' } })
        await call(c, 'run_verify')
      }],
    ])('rejects verified as INVALID_RESULT after %s, and keeps the ticket open', async (_label, before) => {
      const client = await connect()
      await before(client)
      expect(rejected(await call(client, 'submit_result', verified(port8000)))).toMatchObject({ code: 'INVALID_RESULT' })
      expect(run.status).toBe('fixing')
      expect(reruns).toEqual([])
      await client.close()
    })

    it('rejects an empty verified specPatch when only run_verify ran (it checked the original input, no run_deploy)', async () => {
      behave = answering('verify', verifyOk)
      const client = await connect()
      expect((await call(client, 'run_verify')).structuredContent).toMatchObject({ ok: true })
      expect(rejected(await call(client, 'submit_result', verified([])))).toMatchObject({ code: 'INVALID_RESULT' })
      expect(run.status).toBe('fixing')
      expect(reruns).toEqual([])
      await client.close()
    })

    it('rejects verified with another specPatch than the one tried', async () => {
      const client = await connect()
      await tryAndVerify(client)
      const other = [{ op: 'replace', path: '/spec/services/1/runtime/port', value: 8080 }]
      expect(rejected(await call(client, 'submit_result', verified(other)))).toMatchObject({ code: 'INVALID_RESULT' })
      expect(rejected(await call(client, 'submit_result', verified([])))).toMatchObject({ code: 'INVALID_RESULT' })
      expect(run.status).toBe('fixing')
      await client.close()
    })

    it.each([
      ['a build path', [{ op: 'replace', path: '/spec/services/0/build/outputDir', value: 'build' }], 'PATCH_FORBIDDEN'],
      ['a value that breaks the spec rules', [{ op: 'replace', path: '/spec/services/1/runtime/port', value: 0 }], 'INVALID_SPEC'],
    ])('rejects a verified specPatch with %s as %s', async (_label, specPatch, code) => {
      const client = await connect()
      await tryAndVerify(client)
      expect(rejected(await call(client, 'submit_result', verified(specPatch)))).toMatchObject({ code })
      expect(run.status).toBe('fixing')
      await client.close()
    })

    it('ends as failed PIPELINE_UNAVAILABLE and closes the ticket when student-deploy cannot be scheduled', async () => {
      rerunFails = true
      const client = await connect()
      await tryAndVerify(client)
      expect((await call(client, 'submit_result', verified(port8000))).structuredContent).toEqual({ accepted: true })
      expect(run).toMatchObject({ status: 'failed', failure: { code: 'PIPELINE_UNAVAILABLE', stage: 'build', service: null } })
      expect(closes).toEqual([['t_trial', SHA, 'stopped']])
      await client.close()
    })

    it('does not re-run while an earlier trial of the project cannot be confirmed stopped: failed TRIAL_STILL_RUNNING', async () => {
      const client = await connect()
      await tryAndVerify(client)
      // 입력을 읽고 결과를 보내지 않는 run_render가 기다리는 중에 verified를 낸다. 그 취소를 GoCD가 받지 않는다.
      behave = async (trialId) => void (await readInput(trialId))
      cancelOk = false
      const waiting = call(client, 'run_render')
      while (readInputs.length < 3) await new Promise((r) => setTimeout(r, 5))
      expect((await call(client, 'submit_result', verified(port8000))).structuredContent).toEqual({ accepted: true })
      expect(reruns).toEqual([])
      expect(run).toMatchObject({ status: 'failed', failure: { code: 'TRIAL_STILL_RUNNING', stage: 'verify', service: null }, agent_result: { status: 'verified' } })
      expect(closes).toEqual([['t_trial', SHA, 'stopped']])
      // 기다리던 run_render는 티켓이 끝나 거절된다.
      expect(rejected(await waiting)).toMatchObject({ code: 'TICKET_CLOSED' })
      await client.close()
    })

    it('re-runs once the earlier trial could be cancelled on the second look', async () => {
      const client = await connect()
      await tryAndVerify(client)
      behave = async (trialId) => void (await readInput(trialId))
      cancelOk = false
      const waiting = call(client, 'run_render')
      while (readInputs.length < 3) await new Promise((r) => setTimeout(r, 5))
      // 첫 취소(티켓 종료)와 첫 확인은 실패하고, 잠시 뒤 다시 확인할 때 취소된다.
      let cancels = 0
      fakePipeline.cancelTrial = () => Promise.resolve(++cancels >= 3)
      try {
        expect((await call(client, 'submit_result', verified(port8000))).structuredContent).toEqual({ accepted: true })
      } finally {
        fakePipeline.cancelTrial = () => Promise.resolve(cancelOk)
      }
      expect(cancels).toBe(3)
      expect(reruns).toEqual([DEPLOY])
      expect(run.status).toBe('running')
      await waiting
      await client.close()
    })
  })

  describe('pipeline routes', () => {
    it('require the counter of the pipeline run on the input read', async () => {
      let res: { status: number; body: unknown } | undefined
      behave = async (trialId) => {
        const r = await request(app.getHttpServer()).get(`/api/pipeline/trials/${trialId}/input`).set(auth)
        res = { status: r.status, body: r.body }
        await readInput(trialId)
        await postResult(trialId, { stage: 'render', result: { ok: true, status: null, failure: null } })
      }
      const client = await connect()
      await call(client, 'run_render')
      expect(res).toMatchObject({ status: 400, body: { error: { fields: [{ path: 'counter', code: 'REQUIRED' }] } } })
      await client.close()
    })

    it('need the pipeline token', async () => {
      expect((await request(app.getHttpServer()).get('/api/pipeline/trials/tr_000000000000/input')).status).toBe(401)
      expect((await request(app.getHttpServer()).post('/api/pipeline/trials/tr_000000000000/result').send({})).status).toBe(401)
    })

    it('answer 404 for an unknown or malformed trial input, and applied: false for its result', async () => {
      expect((await request(app.getHttpServer()).get('/api/pipeline/trials/tr_000000000000/input').set(auth)).status).toBe(404)
      const bad = await request(app.getHttpServer()).get('/api/pipeline/trials/x/input').set(auth)
      expect(bad.status).toBe(404)
      expect(bad.body).toMatchObject({ error: { code: 'TRIAL_NOT_FOUND' } })
      const late = await postResult('tr_000000000000', { stage: 'render', result: { ok: true, status: null, failure: null } })
      expect(late.status).toBe(200)
      expect(late.body).toEqual({ ok: true, applied: false })
    })

    it('answer 400 with fields for a result of the wrong shape, and keep waiting for a good one', async () => {
      let badAnswer: { status: number; body: unknown } | undefined
      behave = async (trialId) => {
        await readInput(trialId)
        const bad = await postResult(trialId, { stage: 'verify', result: { ok: true, status: null, failure: null } })
        badAnswer = { status: bad.status, body: bad.body }
        await postResult(trialId, { stage: 'render', result: { ok: true, status: null, failure: null } })
      }
      const client = await connect()
      expect((await call(client, 'run_render')).structuredContent).toEqual({ ok: true, status: null, failure: null })
      expect(badAnswer).toMatchObject({ status: 400, body: { error: { code: 'BAD_REQUEST', fields: expect.arrayContaining([{ path: 'stage', code: 'INVALID_VALUE' }]) as unknown } } })
      await client.close()
    })
  })
})
