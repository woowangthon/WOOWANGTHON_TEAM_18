import type { INestApplication } from '@nestjs/common'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { App } from 'supertest/types.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DeploysStore, type DeployRunRow } from '../src/deploys/deploys.store.js'
import { TOTAL_CALLS } from '../src/gateway/budget.js'
import { GatewayServer } from '../src/gateway/gateway.server.js'
import { RepoReader, type RepoEntry } from '../src/gateway/repo-reader.js'
import { tokenHash } from '../src/gateway/tickets.js'
import { ClusterReader } from '../src/k8s/cluster-reader.js'
import { startApp } from './start-app.js'

const SHA = '0123456789abcdef0123456789abcdef01234567'
const DEPLOY = '33333333-3333-4333-8333-333333333333'
const TOKEN = `gw_${'k'.repeat(32)}`
const SECRET = `ghp_${'s'.repeat(36)}`

// 가짜 실행 기록: fixing, 대상 슬롯 b, 서비스 fe · be.
let run: DeployRunRow
const updates: { where: unknown; patch: Record<string, unknown> }[] = []
const fakeStore = {
  findRunByGatewayToken: (hash: string) => Promise.resolve(hash === run.gateway_token_hash ? run : undefined),
  findById: (id: string) => Promise.resolve(id === DEPLOY ? { id, repo: 'student/app', slug: 'my-app' } : undefined),
  updateRun: (_id: string, where: { status?: string }, patch: Record<string, unknown>) => {
    updates.push({ where, patch })
    if (where.status && run.status !== where.status) return Promise.resolve(false)
    Object.assign(run, patch)
    return Promise.resolve(true)
  },
}

const pod = (name: string, slot: string, created: string) => ({
  metadata: { name, labels: { app: 'be', slot }, creationTimestamp: created },
  spec: { containers: [{ name: 'be', env: [{ name: 'API_TOKEN', value: 'plain-env-secret' }] }] },
  status: { phase: 'Running' },
})
const cluster = {
  calls: [] as unknown[][],
  logText: `listening on 3000\nconnect with ${SECRET}\n`,
  rawObjects(slug: string, kind: string, selector?: string) {
    this.calls.push(['rawObjects', slug, kind, selector])
    if (kind === 'pods') return Promise.resolve([pod('be-b-old', 'b', '2026-11-11T01:00:00Z'), pod('be-b-new', 'b', '2026-11-11T02:00:00Z')])
    if (kind === 'deployments') return Promise.resolve([{ metadata: { name: 'be-b', labels: { app: 'be', slot: 'b' } }, status: { readyReplicas: 0, updatedReplicas: 1, availableReplicas: 0 } }])
    return Promise.resolve([
      { reason: 'Unhealthy', involvedObject: { name: 'be-b-new' }, message: 'Readiness probe failed' },
      { reason: 'ScalingReplicaSet', involvedObject: { name: 'be-b' }, message: 'Scaled up replica set be-b-7d9f' },
      { reason: 'Pulled', involvedObject: { name: 'be-a-live' }, message: 'live slot pod' },
    ])
  },
  logs(slug: string, podName: string, options: unknown) {
    this.calls.push(['logs', slug, podName, options])
    return Promise.resolve(this.logText)
  },
}
const repo = {
  calls: [] as unknown[][],
  read(name: string, sha: string, path: string): Promise<RepoEntry | null> {
    this.calls.push([name, sha, path])
    if (path === '') return Promise.resolve({ type: 'dir', entries: [{ name: 'package.json', type: 'file', size: 20 }] })
    if (path === 'package.json') return Promise.resolve({ type: 'file', content: `{"token": "${SECRET}"}`, truncated: false })
    return Promise.resolve(null)
  },
}

let app: INestApplication<App>
let url: string

beforeEach(async () => {
  run = {
    deploy_id: DEPLOY,
    user_id: 'u',
    slug: 'my-app',
    target_slot: 'b',
    input: { commitSha: SHA, spec: { services: [{ name: 'fe' }, { name: 'be' }] } },
    status: 'fixing',
    stage: 'apply',
    failure: { code: 'DEPLOY_FAILED', stage: 'apply', service: 'be' },
    ticket_id: 't_abc',
    gateway_token_hash: tokenHash(TOKEN),
    gateway_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    images: null,
    created_at: '2026-11-11T00:00:00Z',
    updated_at: '2026-11-11T00:00:00Z',
  }
  updates.length = 0
  cluster.calls.length = 0
  repo.calls.length = 0
  app = await startApp([], (b) =>
    b.overrideProvider(DeploysStore).useValue(fakeStore).overrideProvider(ClusterReader).useValue(cluster).overrideProvider(RepoReader).useValue(repo),
  )
  const port = await app.get(GatewayServer).listen(0, '127.0.0.1')
  url = `http://127.0.0.1:${port}/mcp`
})

afterEach(async () => {
  await app.close()
})

async function connect(token: string | null = TOKEN): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '1.0.0' })
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }))
  return client
}

interface Answer {
  isError?: boolean
  structuredContent?: Record<string, unknown>
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Answer> {
  return (await client.callTool({ name, arguments: args })) as Answer
}
const rejected = (a: Answer) => (a.isError ? (a.structuredContent as { code: string }).code : null)

const result = (overrides: Record<string, unknown> = {}) => ({
  ticketId: 't_abc',
  commitSha: SHA,
  status: 'gave_up',
  classification: { method: 'code', caseId: 'A1', path: 'playbook' },
  actions: [{ tool: 'read_pod_logs', ok: true }],
  summary: '포트를 찾지 못했습니다.',
  ...overrides,
})

describe('MCP gateway', () => {
  it('lists only the tools that work without the pipeline', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['get_target_status', 'read_pod_logs', 'read_repo', 'submit_result'])
    await client.close()
  })

  it('reads the target slot status, keeping only its events, with secrets masked', async () => {
    const client = await connect()
    const a = await call(client, 'get_target_status', { service: 'be' })
    expect(a.isError).toBeFalsy()
    const content = a.structuredContent as { pods: { metadata: { name: string } }[]; events: { reason: string }[]; rollouts: unknown[] }
    expect(cluster.calls[0]).toEqual(['rawObjects', 'my-app', 'pods', 'app=be,slot=b'])
    expect(content.pods.map((p) => p.metadata.name)).toEqual(['be-b-old', 'be-b-new'])
    expect(content.events.map((e) => e.reason)).toEqual(['Unhealthy', 'ScalingReplicaSet'])
    expect(content.rollouts).toEqual([{ service: 'be', ready: 0, updated: 1, available: 0 }])
    expect(JSON.stringify(content)).not.toContain('plain-env-secret')
    await client.close()
  })

  it('reads the newest pod logs, previous container if asked, masked', async () => {
    const client = await connect()
    const a = await call(client, 'read_pod_logs', { service: 'be', lines: 50, previous: true })
    expect(cluster.calls.at(-1)).toEqual(['logs', 'my-app', 'be-b-new', { container: 'be', tailLines: 50, previous: true }])
    const { lines } = a.structuredContent as { lines: string[] }
    expect(lines).toEqual(['listening on 3000', 'connect with [REDACTED]'])
    await client.close()
  })

  it.each([
    ['read_pod_logs', { service: 'ai' }],
    ['read_pod_logs', { service: 'be', lines: 201 }],
    ['read_pod_logs', { service: 'be', lines: '5' }],
    ['read_pod_logs', {}],
    ['get_target_status', { service: 'be', extra: 1 }],
    ['read_repo', { path: '../etc/passwd' }],
    ['read_repo', { path: '/abs' }],
    ['read_repo', { path: 'src', source: { commitSha: SHA } }],
    ['read_repo', { path: 'missing.txt' }],
    ['run_deploy', {}],
  ])('rejects %s %j as INVALID_ARGUMENT', async (name, args) => {
    const client = await connect()
    expect(rejected(await call(client, name, args))).toBe('INVALID_ARGUMENT')
    await client.close()
  })

  it('reads repository files at the ticket commit, masked', async () => {
    const client = await connect()
    expect((await call(client, 'read_repo', { path: '.' })).structuredContent).toEqual({ type: 'dir', entries: [{ name: 'package.json', type: 'file', size: 20 }] })
    const file = (await call(client, 'read_repo', { path: './package.json' })).structuredContent
    expect(file).toEqual({ type: 'file', content: '{"token": [REDACTED]}', truncated: false })
    expect(repo.calls[0]).toEqual(['student/app', SHA, ''])
    await client.close()
  })

  it.each([
    ['unknown token', () => `gw_${'z'.repeat(32)}`],
    ['no token', () => null],
    ['expired token', () => ((run.gateway_expires_at = new Date(Date.now() - 1000).toISOString()), TOKEN)],
    ['closed ticket', () => ((run.status = 'needs_user'), TOKEN)],
  ])('answers TICKET_CLOSED for an %s', async (_label, token) => {
    const client = await connect(token())
    expect(rejected(await call(client, 'read_repo', { path: '.' }))).toBe('TICKET_CLOSED')
    await client.close()
  })

  it('blocks the third same call in a row and counts the total', async () => {
    const client = await connect()
    expect(rejected(await call(client, 'read_repo', { path: '.' }))).toBeNull()
    expect(rejected(await call(client, 'read_repo', { path: '.' }))).toBeNull()
    expect(rejected(await call(client, 'read_repo', { path: '.' }))).toBe('REPEATED_CALL')
    // 다른 인자로 바꾸면 다시 된다. 막힌 호출은 세지 않는다.
    for (let i = 2; i < TOTAL_CALLS; i++) {
      expect(rejected(await call(client, 'read_repo', { path: i % 2 ? '.' : 'package.json' }))).toBeNull()
    }
    expect(rejected(await call(client, 'get_target_status'))).toBe('TOOL_LIMIT')
    // 한도 뒤에도 결과는 낼 수 있다.
    expect((await call(client, 'submit_result', { result: result() })).structuredContent).toEqual({ accepted: true })
    await client.close()
  })

  it('takes gave_up: the run fails as AGENT_GAVE_UP and the token closes', async () => {
    const client = await connect()
    const summary = `로그에 ${SECRET}가 있어 멈췄습니다.`
    expect((await call(client, 'submit_result', { result: result({ summary }) })).structuredContent).toEqual({ accepted: true })
    expect(updates).toEqual([
      {
        where: { status: 'fixing' },
        patch: {
          status: 'failed',
          failure: { code: 'AGENT_GAVE_UP', stage: 'apply', service: 'be' },
          // 학생에게 보일 칸만, 한 번 더 가려서 저장한다(actions는 버린다).
          agent_result: {
            status: 'gave_up',
            summary: '로그에 [REDACTED]가 있어 멈췄습니다.',
            userRequest: null,
            pr: null,
            evidence: [],
            classification: { method: 'code', caseId: 'A1', path: 'playbook' },
          },
          gateway_token_hash: null,
        },
      },
    ])
    expect(rejected(await call(client, 'read_repo', { path: '.' }))).toBe('TICKET_CLOSED')
    await client.close()
  })

  it.each([
    ['needs_user', { userRequest: { message: 'DATABASE_URL을 다시 넣어 주세요', secretKeys: ['DATABASE_URL'] } }],
    ['pr_opened', { pr: { url: 'https://github.com/student/app/pull/1', files: ['vite.config.ts'], changedLines: 1 } }],
  ])('takes %s: the run waits for the student', async (status, extra) => {
    const client = await connect()
    expect((await call(client, 'submit_result', { result: result({ status, ...extra }) })).structuredContent).toEqual({ accepted: true })
    expect(run.status).toBe('needs_user')
    expect(run.agent_result).toMatchObject({ status, ...extra })
    expect(run.gateway_token_hash).toBeNull()
    await client.close()
  })

  it.each([
    ['verified before the trial-run tools exist', { status: 'verified', specPatch: [] }],
    ['another commit', { commitSha: 'f'.repeat(40) }],
    ['another ticket', { ticketId: 't_other' }],
    ['needs_user without userRequest', { status: 'needs_user' }],
    ['pr_opened without pr', { status: 'pr_opened' }],
    ['an unknown key', { extra: 1 }],
    ['an empty summary', { summary: ' ' }],
    ['a bad classification', { classification: { method: 'guess', caseId: null, path: 'plan' } }],
    ['too many PR files', { status: 'pr_opened', pr: { files: ['a', 'b', 'c', 'd', 'e', 'f'] } }],
  ])('rejects a result with %s as INVALID_RESULT and keeps the ticket open', async (_label, overrides) => {
    const client = await connect()
    expect(rejected(await call(client, 'submit_result', { result: result(overrides) }))).toBe('INVALID_RESULT')
    expect(run.status).toBe('fixing')
    expect(updates).toEqual([])
    await client.close()
  })

  it('answers only POST /mcp', async () => {
    expect((await fetch(url.replace('/mcp', '/other'), { method: 'POST' })).status).toBe(404)
    expect((await fetch(url)).status).toBe(405)
    const bad = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `{"token": "${SECRET}"` })
    expect(bad.status).toBe(400)
    expect(await bad.text()).not.toContain(SECRET)
  })
})
