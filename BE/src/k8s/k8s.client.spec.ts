import { Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import http from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { type Answer, FakeK8s } from '../../test/fake-k8s.js'
import type { Env } from '../config/env.js'
import { ClusterError } from './cluster-error.js'
import { K8sClient } from './k8s.client.js'

const TOKEN = 'k8s-secret-token'
const clientOf = (url: string | undefined) => new K8sClient(new ConfigService<Env, true>({ K8S_API_URL: url, K8S_TOKEN: url && TOKEN, K8S_CA_CERT: url && 'unused' }))
const caught = (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => e as ClusterError)

describe('K8sClient', () => {
  let fake: FakeK8s
  let url: string
  let client: K8sClient
  beforeAll(async () => {
    fake = new FakeK8s(http.createServer())
    url = await fake.listen()
    client = clientOf(url)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fake.reset()
  })
  afterAll(async () => {
    client.onModuleDestroy()
    await fake.close()
  })

  it('sends the method, the path and the bearer token, and returns the answer text on 2xx', async () => {
    fake.answers.set('/x?y=1', { status: 200, body: 'plain text' })
    await expect(client.request('GET', '/x?y=1')).resolves.toBe('plain text')
    expect(fake.seen).toMatchObject([{ method: 'GET', path: '/x?y=1', auth: `Bearer ${TOKEN}`, contentType: undefined, body: undefined }])
  })

  it('sends a JSON body when one is given', async () => {
    await client.request('PUT', '/x', { a: 1 })
    expect(fake.seen).toMatchObject([{ method: 'PUT', contentType: 'application/json', body: { a: 1 } }])
  })

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'rejected'],
    [400, 'unexpected'],
    [500, 'unexpected'],
    [300, 'unexpected'],
    [302, 'unexpected'],
    [199, 'unexpected'],
  ])('turns %i into a ClusterError of kind %s that is still a 503 CLUSTER_UNAVAILABLE', async (status, kind) => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    // 1xx는 node가 응답으로 치지 않아 가짜 서버로 만들 수 없다. 199는 경계만 본다.
    if (status === 199) return expect(ClusterError.ofStatus(199, undefined).kind).toBe(kind)
    fake.answers.set('/x', { status, body: { reason: 'Why', message: 'secret-looking detail' } })
    const err = await caught(client.request('GET', '/x'))
    expect(err).toBeInstanceOf(ClusterError)
    expect(err).toBeInstanceOf(ServiceUnavailableException)
    expect(err).toMatchObject({ kind, apiStatus: status, apiReason: 'Why', response: { code: 'CLUSTER_UNAVAILABLE' } })
    expect(err?.getStatus()).toBe(503)
  })

  it('accepts every 2xx in request, and only 201 in create', async () => {
    fake.answers.set('/x', { status: 299 })
    await expect(client.request('GET', '/x')).resolves.toBeTypeOf('string')
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    fake.answers.set('/x', { status: 200 })
    expect(await caught(client.create('/x', {}))).toMatchObject({ kind: 'unexpected', apiStatus: 200 })
  })

  it('create tells created from exists, and logs no error for either', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    await expect(client.create('/x', {})).resolves.toBe('created')
    fake.answers.set('/x', { status: 409, body: { reason: 'AlreadyExists' } })
    await expect(client.create('/x', {})).resolves.toBe('exists')
    expect(logged).not.toHaveBeenCalled()
  })

  it('a 409 that is not AlreadyExists is a conflict, in create too', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    fake.answers.set('/x', { status: 409, body: { reason: 'Conflict' } })
    expect(await caught(client.create('/x', {}))).toMatchObject({ kind: 'conflict', apiReason: 'Conflict' })
    // reason만 같고 상태가 다른 응답은 '이미 있음'이 아니다.
    fake.answers.set('/x', { status: 400, body: { reason: 'AlreadyExists' } })
    expect(await caught(client.create('/x', {}))).toMatchObject({ kind: 'unexpected', apiStatus: 400 })
  })

  it('is unreachable when the connection drops, and unconfigured without settings', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    fake.answers.set('/x', 'hangup')
    expect(await caught(client.request('GET', '/x'))).toMatchObject({ kind: 'unreachable', apiStatus: undefined })
    expect(await caught(clientOf(undefined).request('GET', '/x'))).toMatchObject({ kind: 'unconfigured' })
    expect(fake.seen).toHaveLength(1)
  })

  it('reuses one connection for requests that follow each other', async () => {
    for (let i = 0; i < 3; i++) await client.request('GET', '/x')
    await client.create('/x', {})
    expect(new Set(fake.seen.map((s) => s.port)).size).toBe(1)
  })

  it('works again after the server dropped the connection it was reusing', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    await client.request('GET', '/x')
    fake.answers.set('/x', 'hangup')
    await caught(client.request('GET', '/x'))
    fake.answers.clear()
    await expect(client.request('GET', '/x')).resolves.toBeTypeOf('string')
  })

  it('closes its connections on shutdown', async () => {
    const own = clientOf(url)
    await own.request('GET', '/x')
    const open = () => new Promise<number>((resolve) => fake.server.getConnections((_, n) => resolve(n)))
    const before = await open()
    own.onModuleDestroy()
    await vi.waitFor(async () => expect(await open()).toBe(before - 1))
  })

  // 토큰 · 보낸 본문 · 응답 본문은 어떤 실패에서도 로그와 오류에 남지 않는다.
  it.each([
    ['a refusal', { status: 403, body: { reason: 'Forbidden', message: 'answer-detail-123' } }],
    ['an answer that is not JSON', { status: 502, body: 'answer-detail-123' }],
    ['a dropped connection', 'hangup'],
  ] as [string, Answer][])('keeps the token, the sent body and the answer out of logs and errors on %s', async (_, answer) => {
    const spies = (['error', 'warn', 'log', 'debug', 'verbose'] as const).map((level) => vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined))
    fake.answers.set('/x?q=query-value-456', answer)
    const err = await caught(client.request('PUT', '/x?q=query-value-456', { data: { KEY: 'sent-value-789' } }))
    const told = JSON.stringify([spies.map((s) => s.mock.calls), err, err?.message, err?.stack, err?.getResponse(), Object.entries(err ?? {})])
    expect(told).not.toMatch(new RegExp(`${TOKEN}|answer-detail-123|sent-value-789|query-value-456|127\\.0\\.0\\.1`))
    expect(spies[0]).toHaveBeenCalledWith(expect.stringMatching(/^PUT \/x (answered \d+|failed: \w+)/))
  })
})
