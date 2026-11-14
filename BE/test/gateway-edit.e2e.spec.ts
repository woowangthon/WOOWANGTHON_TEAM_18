import type { INestApplication } from '@nestjs/common'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentClient } from '../src/deploys/agent.client.js'
import { DeployConditionService } from '../src/deploys/deploy-condition.service.js'
import type { DeployRunRow } from '../src/deploys/deploys.store.js'
import { DeploysStore } from '../src/deploys/deploys.store.js'
import { PipelineClient } from '../src/deploys/pipeline.client.js'
import { type BaseEntry, BotError, BotRepo, type PullOutcome } from '../src/gateway/bot-repo.js'
import { GatewayServer } from '../src/gateway/gateway.server.js'
import { RepoReader } from '../src/gateway/repo-reader.js'
import { tokenHash } from '../src/gateway/tickets.js'
import { ClusterReader } from '../src/k8s/cluster-reader.js'
import { DeploymentScaler } from '../src/k8s/deployment-scaler.js'
import { validSpec } from './spec-fixture.js'
import { startApp } from './start-app.js'

// 레포 수정(F13, api.md "레포 수정 · 끝내기"): 실제 HTTP 위의 MCP 클라이언트 → 게이트웨이 → 가짜 봇 GitHub · 가짜 GoCD.
// edit_repo_file이 만든 봇 fork commit을 `source`로 시험(run_build · run_deploy · run_verify)한 뒤에만 open_pr이 열린다.

const SHA = '0123456789abcdef0123456789abcdef01234567'
const DEPLOY = '55555555-5555-4555-8555-555555555555'
const TOKEN = `gw_${'e'.repeat(32)}`
const NOTIFY = process.env.PIPELINE_NOTIFY_TOKEN ?? ''
const BOT_TOKEN = `ghp_${'b'.repeat(36)}`
const FORK = 'wanggane-bot/my-app'
const FE_IMAGE = `ghcr.io/woowang-bot/student-apps@sha256:${'f'.repeat(64)}`
const BE_IMAGE = `ghcr.io/woowang-bot/student-apps@sha256:${'e'.repeat(64)}`
const NEW_IMAGE = `ghcr.io/woowang-bot/student-apps@sha256:${'9'.repeat(64)}`
const HASH = (c: string) => `sha256:${c.repeat(64)}`
const PR_URL = 'https://github.com/student/my-app/pull/12'

let run: DeployRunRow
const hashed: unknown[][] = []
// 봇 fork의 commit은 FE/App.tsx를 고쳤다: fe의 빌드 컨텍스트(FE)도 be의 컨텍스트('.', 레포 전체)도 내용이 바뀌어 두 해시가 모두 바뀐다.
// unchanged에 든 컨텍스트는 fork에서도 해시가 같다(내용이 그대로인 서비스).
const unchanged = new Set<string>()
const fakeConditions = {
  buildHash: (repo: string, commit: string, build: { context: string }) => {
    hashed.push([repo, commit, build.context])
    if (repo === FORK && !unchanged.has(build.context)) return Promise.resolve(build.context === '.' ? HASH('9') : HASH('8'))
    return Promise.resolve(build.context === '.' ? HASH('b') : HASH('a'))
  },
}
const fakeStore = {
  liveSlot: () => Promise.resolve(null),
  findActiveRun: () => Promise.resolve(undefined),
  findRunByGatewayToken: (hash: string) => Promise.resolve(hash === run.gateway_token_hash ? run : undefined),
  findById: (id: string) => Promise.resolve(id === DEPLOY ? { id, repo: 'student/my-app', slug: 'my-app' } : undefined),
  findRun: (id: string) => Promise.resolve(id === DEPLOY ? run : undefined),
  findLastSucceededRun: () => Promise.resolve(undefined),
  cachedImage: () => Promise.resolve(null),
  cacheImages: () => Promise.resolve(),
  updateRun: (_id: string, where: { status?: string }, patch: Record<string, unknown>) => {
    if (where.status && run.status !== where.status) return Promise.resolve(false)
    Object.assign(run, patch)
    return Promise.resolve(true)
  },
}

class FakeBot {
  token = true
  failWith: BotError | null = null
  pullOutcome: PullOutcome = { opened: true, url: PR_URL }
  forks: string[] = []
  commits: { parent: string; branch: string; files: { path: string; content: string }[]; message: string }[] = []
  pulls: { upstream: string; branch: string; title: string; body: string }[] = []
  moves: { branch: string; sha: string }[] = []
  available = () => this.token
  fork(repo: string): Promise<string> {
    this.forks.push(repo)
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve(FORK)
  }
  tree(): Promise<{ treeSha: string; entries: Map<string, BaseEntry>; truncated: boolean }> {
    return Promise.resolve({
      treeSha: 'tree0',
      truncated: false,
      entries: new Map([
        ['FE/App.tsx', { mode: '100644', type: 'blob', sha: 'b1', size: 20 }],
        ['BE/Dockerfile', { mode: '100644', type: 'blob', sha: 'b2', size: 20 }],
      ]),
    })
  }
  blob = (_fork: string, sha: string) => Promise.resolve(Buffer.from(sha === 'b1' ? "import x from './app'\n" : 'FROM node:22\nCMD ["node", "x.js"]\n'))
  commit(_fork: string, parent: string, _tree: string, branch: string, files: { path: string; content: string }[], message: string): Promise<string> {
    this.commits.push({ parent, branch, files, message })
    return Promise.resolve(String(this.commits.length).padStart(40, 'a'))
  }
  moveBranch(_fork: string, branch: string, sha: string): Promise<void> {
    this.moves.push({ branch, sha })
    return Promise.resolve()
  }
  pull(upstream: string, branch: string, title: string, body: string): Promise<PullOutcome> {
    this.pulls.push({ upstream, branch, title, body })
    return Promise.resolve(this.pullOutcome)
  }
  patch = () => Promise.resolve('diff --git a/FE/App.tsx b/FE/App.tsx\n')
}
let bot: FakeBot
const reads: unknown[][] = []
const fakeRepo = {
  read: (repo: string, commit: string, path: string) => {
    reads.push([repo, commit, path])
    return Promise.resolve({ type: 'file', content: "import x from './App'\n", truncated: false })
  },
}

type Behave = (trialId: string, stages: string) => Promise<void>
let scheduled: { trialId: string; stages: string }[]
let behave: Behave
let reruns: string[]
const fakePipeline = {
  runTrial(_deployId: string, trialId: string, stages: string) {
    scheduled.push({ trialId, stages })
    setImmediate(() => void behave(trialId, stages))
    return Promise.resolve()
  },
  cancelTrial: () => Promise.resolve(true),
  cancelAllTrials: () => Promise.resolve(0),
  run(deployId: string) {
    reruns.push(deployId)
    return Promise.resolve()
  },
}
const fakeAgent = { close: () => Promise.resolve(true) }

let app: INestApplication<App>
let url: string
const readInputs: { input: Record<string, unknown> }[] = []
const auth = { Authorization: `Bearer ${NOTIFY}` }
const answering =
  (stage: string, result: Record<string, unknown>): Behave =>
  async (trialId) => {
    const res = await request(app.getHttpServer()).get(`/api/pipeline/trials/${trialId}/input?counter=7`).set(auth)
    readInputs.push(res.body as { input: Record<string, unknown> })
    await request(app.getHttpServer()).post(`/api/pipeline/trials/${trialId}/result`).set(auth).send({ stage, result })
  }
const buildOk = { ok: true, reused: false, build: null, failedPhase: null, logTail: [], image: NEW_IMAGE, failure: null }
const deployOk = { ok: true, services: [{ service: 'fe', ready: true, reason: null }, { service: 'be', ready: true, reason: null }], pods: [], events: [], failure: null }
const verifyOk = { ok: true, ready: [{ service: 'fe', ready: true }, { service: 'be', ready: true }], requests: [], failure: null }

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
    stage: 'build',
    failure: { code: 'BUILD_FAILED', stage: 'build', service: 'be' },
    ticket_id: 't_edit',
    gateway_token_hash: tokenHash(TOKEN),
    gateway_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    images: null,
    created_at: '2026-11-11T00:00:00Z',
    updated_at: new Date().toISOString(),
  }
  bot = new FakeBot()
  hashed.length = 0
  unchanged.clear()
  reads.length = 0
  readInputs.length = 0
  scheduled = []
  reruns = []
  behave = answering('apply', deployOk)
  app = await startApp([], (b) =>
    b
      .overrideProvider(DeploysStore)
      .useValue(fakeStore)
      .overrideProvider(PipelineClient)
      .useValue(fakePipeline)
      .overrideProvider(ClusterReader)
      .useValue({ deployments: () => Promise.resolve([]) })
      .overrideProvider(DeploymentScaler)
      .useValue({ scaleToZero: () => Promise.resolve() })
      .overrideProvider(RepoReader)
      .useValue(fakeRepo)
      .overrideProvider(AgentClient)
      .useValue(fakeAgent)
      .overrideProvider(DeployConditionService)
      .useValue(fakeConditions)
      .overrideProvider(BotRepo)
      .useValue(bot),
  )
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

const fix = [{ path: 'FE/App.tsx', content: "import x from './App'\n" }]
/** edit_repo_file 한 번. 돌려받은 source. */
async function edited(client: Client, files: unknown[] = fix): Promise<{ commitSha: string }> {
  const answer = await call(client, 'edit_repo_file', { files, message: 'fix: import 대소문자' })
  expect(rejected(answer)).toBeNull()
  return (answer.structuredContent as { source: { commitSha: string } }).source
}
const prArgs = (source: unknown) => ({ source, title: 'fix: import 대소문자', body: 'FE/App.tsx의 import 경로를 파일 이름과 맞췄습니다.' })
const pr = (url: string, extra: Record<string, unknown> = {}) => ({
  result: {
    ticketId: 't_edit',
    commitSha: SHA,
    status: 'pr_opened',
    classification: { method: 'code', caseId: 'A2', path: 'playbook' },
    actions: [],
    summary: 'import 경로의 대소문자를 고치는 PR을 열었습니다.',
    pr: { url, files: ['FE/App.tsx'], changedLines: 2 },
    ...extra,
  },
})

describe('edit_repo_file', () => {
  it('commits on the bot fork on top of the ticket commit and answers the new source, the files and the changed lines', async () => {
    const client = await connect()
    const answer = await call(client, 'edit_repo_file', { files: fix, message: 'fix: import 대소문자' })
    expect(answer.structuredContent).toEqual({ source: { commitSha: expect.stringMatching(/^a{39}1$/) as string }, files: ['FE/App.tsx'], changedLines: 2 })
    expect(bot.forks).toEqual(['student/my-app'])
    expect(bot.commits).toEqual([{ parent: SHA, branch: 'wcp-edit-t_edit', files: [{ ...fix[0], mode: '100644' }], message: 'fix: import 대소문자' }])
    await client.close()
  })

  it.each([
    ['.env', [{ path: '.env', content: 'A=1\n' }], 'EDIT_FORBIDDEN'],
    ['.github/', [{ path: '.github/workflows/x.yml', content: 'a\n' }], 'EDIT_FORBIDDEN'],
    ['a secret-looking value', [{ path: 'FE/App.tsx', content: `const t = '${BOT_TOKEN}'\n` }], 'EDIT_FORBIDDEN'],
    ['no files', [], 'INVALID_ARGUMENT'],
  ])('refuses %s as %s', async (_name, files, code) => {
    const client = await connect()
    const answer = await call(client, 'edit_repo_file', { files, message: 'm' })
    expect(rejected(answer)).toMatchObject({ code })
    expect(JSON.stringify(answer)).not.toContain(BOT_TOKEN)
    expect(bot.commits).toEqual([])
    await client.close()
  })

  it('refuses a missing argument and an unknown one', async () => {
    const client = await connect()
    expect(rejected(await call(client, 'edit_repo_file', { files: fix }))).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'missing argument message' })
    expect(rejected(await call(client, 'edit_repo_file', { files: fix, message: 'm', branch: 'main' }))).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'unknown argument branch' })
    await client.close()
  })

  it('answers BOT_UNAVAILABLE without a bot token, for both tools', async () => {
    bot.token = false
    const client = await connect()
    expect(rejected(await call(client, 'edit_repo_file', { files: fix, message: 'm' }))).toMatchObject({ code: 'BOT_UNAVAILABLE' })
    expect(rejected(await call(client, 'open_pr', prArgs({ commitSha: SHA })))).toMatchObject({ code: 'BOT_UNAVAILABLE' })
    expect(bot.forks).toEqual([])
    await client.close()
  })

  it('counts at most 5 calls per ticket', async () => {
    const client = await connect()
    for (let i = 0; i < 5; i++) await call(client, 'edit_repo_file', { files: [{ path: `n${i}.txt`, content: `${i}\n` }], message: `m${i}` })
    // 6번째 파일은 5개 상한이 먼저 닿는다. 상한 횟수는 도구 호출 횟수다.
    expect(rejected(await call(client, 'edit_repo_file', { files: [{ path: 'n9.txt', content: '9\n' }], message: 'm9' }))).toMatchObject({ code: 'TOOL_LIMIT' })
    await client.close()
  })
})

describe('source', () => {
  it('lets read_repo read the bot fork commit', async () => {
    const client = await connect()
    const source = await edited(client)
    const answer = await call(client, 'read_repo', { path: 'FE/App.tsx', source })
    expect(answer.structuredContent).toMatchObject({ type: 'file' })
    expect(reads).toEqual([[FORK, source.commitSha, 'FE/App.tsx']])
    await client.close()
  })

  it.each([
    ['read_repo', { path: '.' }],
    ['run_build', { service: 'be' }],
    ['run_deploy', {}],
  ])('refuses a source edit_repo_file never returned in %s', async (tool, args) => {
    const client = await connect()
    expect(rejected(await call(client, tool, { ...args, source: { commitSha: SHA } }))).toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('not a commit that edit_repo_file returned') as string })
    expect(rejected(await call(client, tool, { ...args, source: { commitSha: 'zz' } }))).toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('source must be') as string })
    expect(scheduled).toEqual([])
    expect(reads).toEqual([])
    await client.close()
  })

  it('builds from the bot fork commit: the trial input carries the fork and the commit, and a service whose content did not change keeps its image', async () => {
    unchanged.add('FE')
    const client = await connect()
    const source = await edited(client)
    behave = answering('build', buildOk)
    expect((await call(client, 'run_build', { service: 'be', source })).structuredContent).toEqual(buildOk)
    const input = readInputs[0].input as { commitSha: string; spec: { project: { repo: string } }; deploy_condition: { services: Record<string, unknown> } }
    expect(input.commitSha).toBe(source.commitSha)
    expect(input.spec.project.repo).toBe(FORK)
    // fe의 내용은 같아 기존 이미지를 쓰고, be는 새 해시로 빌드한다.
    expect(input.deploy_condition.services).toEqual({ fe: { buildInputHash: HASH('a'), build: 'reuse', image: FE_IMAGE }, be: { buildInputHash: HASH('9'), build: 'run', image: null } })
    expect(hashed).toEqual([[FORK, source.commitSha, 'FE'], [FORK, source.commitSha, '.']])
    // 실행 기록의 입력은 그대로다(학생이 확정한 레포 · commit).
    expect(run.input.commitSha).toBe(SHA)
    await client.close()
  })

  it('builds two services whose content both changed with one source, one after the other (neither waits for the other image)', async () => {
    const client = await connect()
    const source = await edited(client)
    behave = answering('build', buildOk)
    // be를 빌드할 때 fe는 아직 새 이미지가 없다: 빌드 단계는 fe를 건드리지 않으므로 실행 기록의 이미지로 자리만 채운다.
    expect(rejected(await call(client, 'run_build', { service: 'be', source }))).toBeNull()
    expect(readInputs[0].input.deploy_condition).toEqual({ services: { fe: { buildInputHash: HASH('8'), build: 'reuse', image: FE_IMAGE }, be: { buildInputHash: HASH('9'), build: 'run', image: null } } })
    expect(rejected(await call(client, 'run_build', { service: 'fe', source }))).toBeNull()
    expect(readInputs[1].input.deploy_condition).toEqual({ services: { fe: { buildInputHash: HASH('8'), build: 'run', image: null }, be: { buildInputHash: HASH('9'), build: 'reuse', image: NEW_IMAGE } } })
    // 배포에는 자리 채움이 아니라 둘 다 새 이미지가 쓰인다.
    behave = answering('apply', deployOk)
    expect(rejected(await call(client, 'run_deploy', { source }))).toBeNull()
    expect(readInputs[2].input.deploy_condition).toEqual({ services: { fe: { buildInputHash: HASH('8'), build: 'reuse', image: NEW_IMAGE }, be: { buildInputHash: HASH('9'), build: 'reuse', image: NEW_IMAGE } } })
    await client.close()
  })

  it('cannot deploy the source before the changed service was built from it', async () => {
    const client = await connect()
    const source = await edited(client)
    expect(rejected(await call(client, 'run_deploy', { source }))).toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('call run_build') as string })
    await client.close()
  })
})

describe('the whole fix: edit → run_build → run_deploy → run_verify → open_pr → pr_opened', () => {
  async function buildBoth(client: Client, source: { commitSha: string }): Promise<void> {
    behave = answering('build', buildOk)
    expect(rejected(await call(client, 'run_build', { service: 'be', source }))).toBeNull()
    expect(rejected(await call(client, 'run_build', { service: 'fe', source }))).toBeNull()
  }
  async function verifiedSource(client: Client): Promise<{ commitSha: string }> {
    const source = await edited(client)
    await buildBoth(client, source)
    behave = answering('apply', deployOk)
    expect(rejected(await call(client, 'run_deploy', { source }))).toBeNull()
    behave = answering('verify', verifyOk)
    expect(rejected(await call(client, 'run_verify'))).toBeNull()
    return source
  }

  it('opens the pull request and ends the ticket with pr_opened, with the files and lines the gateway counted', async () => {
    const client = await connect()
    const source = await verifiedSource(client)
    // run_deploy · run_verify는 같은 입력(봇 fork commit)이다.
    expect(readInputs[2].input.commitSha).toBe(source.commitSha)
    expect(readInputs[3].input.commitSha).toBe(source.commitSha)
    const opened = await call(client, 'open_pr', prArgs(source))
    expect(opened.structuredContent).toEqual({ url: PR_URL })
    expect(bot.pulls).toEqual([{ upstream: 'student/my-app', branch: 'wcp-fix-t_edit', title: 'fix: import 대소문자', body: expect.stringContaining('import 경로') as string }])
    expect(bot.moves).toEqual([{ branch: 'wcp-fix-t_edit', sha: source.commitSha }])

    // 에이전트가 틀린 파일 · 줄 수를 적어도 게이트웨이가 센 값이 저장된다.
    const submitted = await call(client, 'submit_result', pr(PR_URL, { pr: { url: PR_URL, files: ['x', 'y'], changedLines: 49 } }))
    expect(submitted.structuredContent).toEqual({ accepted: true })
    expect(run).toMatchObject({ status: 'needs_user', gateway_token_hash: null })
    expect(run.agent_result).toMatchObject({ status: 'pr_opened', pr: { url: PR_URL, files: ['FE/App.tsx'], changedLines: 2 } })
    // 학생 레포의 commit으로 다시 배포하지 않는다(머지를 기다린다).
    expect(reruns).toEqual([])
    await client.close()
  })

  it('refuses open_pr before any trial of the source (NOT_VERIFIED)', async () => {
    const client = await connect()
    const source = await edited(client)
    expect(rejected(await call(client, 'open_pr', prArgs(source)))).toMatchObject({ code: 'NOT_VERIFIED' })
    expect(bot.pulls).toEqual([])
    await client.close()
  })

  it('refuses open_pr when only the original commit passed run_verify, or run_deploy was not run with the source', async () => {
    const client = await connect()
    const source = await edited(client)
    behave = answering('apply', deployOk)
    await call(client, 'run_deploy', {})
    behave = answering('verify', verifyOk)
    await call(client, 'run_verify')
    expect(rejected(await call(client, 'open_pr', prArgs(source)))).toMatchObject({ code: 'NOT_VERIFIED' })
    await client.close()
  })

  it('refuses open_pr when run_deploy with the source passed but run_verify did not', async () => {
    const client = await connect()
    const source = await edited(client)
    await buildBoth(client, source)
    behave = answering('apply', deployOk)
    await call(client, 'run_deploy', { source })
    expect(rejected(await call(client, 'open_pr', prArgs(source)))).toMatchObject({ code: 'NOT_VERIFIED' })
    await client.close()
  })

  it('forgets the check when run_deploy runs again without the source', async () => {
    const client = await connect()
    const source = await verifiedSource(client)
    // 원래 commit의 be 이미지가 있어야 source 없는 run_deploy를 시험할 수 있다.
    run.images = { be: BE_IMAGE }
    behave = answering('apply', deployOk)
    expect(rejected(await call(client, 'run_deploy', { specPatch: [{ op: 'replace', path: '/spec/services/1/runtime/port', value: 8000 }] }))).toBeNull()
    expect(rejected(await call(client, 'open_pr', prArgs(source)))).toMatchObject({ code: 'NOT_VERIFIED' })
    await client.close()
  })

  it('does not take a source the verified deploy did not use (an earlier commit of the same ticket)', async () => {
    const client = await connect()
    const first = await edited(client)
    const second = await edited(client, [{ path: 'FE/App.tsx', content: "import y from './App'\n" }])
    await buildBoth(client, second)
    behave = answering('apply', deployOk)
    await call(client, 'run_deploy', { source: second })
    behave = answering('verify', verifyOk)
    await call(client, 'run_verify')
    expect(rejected(await call(client, 'open_pr', prArgs(first)))).toMatchObject({ code: 'NOT_VERIFIED' })
    expect(rejected(await call(client, 'open_pr', prArgs(second)))).toBeNull()
    await client.close()
  })

  it('refuses open_pr when the source passed only together with a specPatch (the pull request would not carry the spec change)', async () => {
    const client = await connect()
    const source = await edited(client)
    await buildBoth(client, source)
    behave = answering('apply', deployOk)
    expect(rejected(await call(client, 'run_deploy', { source, specPatch: [{ op: 'replace', path: '/spec/services/1/runtime/port', value: 8000 }] }))).toBeNull()
    behave = answering('verify', verifyOk)
    expect(rejected(await call(client, 'run_verify'))).toBeNull()
    expect(rejected(await call(client, 'open_pr', prArgs(source)))).toMatchObject({ code: 'NOT_VERIFIED' })
    expect(bot.pulls).toEqual([])
    await client.close()
  })

  it('opens one pull request per ticket: asking again answers the same url', async () => {
    const client = await connect()
    const source = await verifiedSource(client)
    await call(client, 'open_pr', prArgs(source))
    expect((await call(client, 'open_pr', { ...prArgs(source), title: 'another title' })).structuredContent).toEqual({ url: PR_URL })
    expect(bot.pulls).toHaveLength(1)
    await client.close()
  })

  it('answers without a url when the student repository does not take the pull request, refuses pr_opened, and attaches the patch to needs_user itself', async () => {
    bot.pullOutcome = { opened: false }
    const client = await connect()
    const source = await verifiedSource(client)
    const opened = await call(client, 'open_pr', prArgs(source))
    // 에이전트는 patch 글을 받지 않는다(모델 출력 상한에 잘리지 않게).
    expect(opened.structuredContent).toEqual({ url: null, patchAttached: true })
    expect(rejected(await call(client, 'submit_result', pr(PR_URL)))).toMatchObject({ code: 'INVALID_RESULT' })
    const needs = { result: { ...pr(PR_URL).result, status: 'needs_user', pr: undefined, userRequest: { message: 'FE/App.tsx의 import를 고친 patch를 붙입니다.' } } }
    expect((await call(client, 'submit_result', needs)).structuredContent).toEqual({ accepted: true })
    expect(run.agent_result).toMatchObject({ status: 'needs_user', userRequest: { message: 'FE/App.tsx의 import를 고친 patch를 붙입니다.\n\ndiff --git a/FE/App.tsx b/FE/App.tsx\n' } })
    await client.close()
  })

  it('does not take pr_opened without an open_pr, or with another url than the one open_pr returned', async () => {
    const client = await connect()
    expect(rejected(await call(client, 'submit_result', pr(PR_URL)))).toMatchObject({ code: 'INVALID_RESULT', message: expect.stringContaining('open_pr returned') as string })
    const source = await verifiedSource(client)
    await call(client, 'open_pr', prArgs(source))
    expect(rejected(await call(client, 'submit_result', pr('https://github.com/student/my-app/pull/99')))).toMatchObject({ code: 'INVALID_RESULT' })
    expect(rejected(await call(client, 'submit_result', pr(PR_URL, { pr: { files: ['a'] } })))).toMatchObject({ code: 'INVALID_RESULT' })
    // 틀린 결과로는 티켓이 끝나지 않는다.
    expect(run.status).toBe('fixing')
    expect((await call(client, 'submit_result', pr(PR_URL))).structuredContent).toEqual({ accepted: true })
    await client.close()
  })

  it('does not take verified for a ticket whose last passing deploy used the bot fork commit', async () => {
    const client = await connect()
    await verifiedSource(client)
    const verified = { result: { ticketId: 't_edit', commitSha: SHA, status: 'verified', classification: { method: 'code', caseId: null, path: 'plan' }, actions: [], summary: 's', specPatch: [] } }
    expect(rejected(await call(client, 'submit_result', verified))).toMatchObject({ code: 'INVALID_RESULT' })
    expect(reruns).toEqual([])
    await client.close()
  })

  it('answers BOT_UNAVAILABLE when GitHub fails on open_pr and lets the agent try again', async () => {
    const client = await connect()
    const source = await verifiedSource(client)
    bot.pull = () => Promise.reject(new BotError('github'))
    expect(rejected(await call(client, 'open_pr', prArgs(source)))).toMatchObject({ code: 'BOT_UNAVAILABLE' })
    bot.pull = FakeBot.prototype.pull.bind(bot)
    expect(rejected(await call(client, 'open_pr', { ...prArgs(source), title: 'retry' }))).toBeNull()
    await client.close()
  })
})
