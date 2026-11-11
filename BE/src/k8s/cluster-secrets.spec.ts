import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import http from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { FakeK8s } from '../../test/fake-k8s.js'
import type { Env } from '../config/env.js'
import { ClusterSecrets } from './cluster-secrets.js'
import { K8sClient } from './k8s.client.js'

const TOKEN = 'k8s-secret-token'
const LIST = '/api/v1/namespaces/proj-my-app/secrets'
const ONE = `${LIST}/api-secrets`
const exists = { status: 409, body: { kind: 'Status', reason: 'AlreadyExists' } }
const b64 = (v: string) => Buffer.from(v, 'utf8').toString('base64')

describe('ClusterSecrets.write', () => {
  let fake: FakeK8s
  let client: K8sClient
  let secrets: ClusterSecrets
  beforeAll(async () => {
    fake = new FakeK8s(http.createServer())
    client = new K8sClient(new ConfigService<Env, true>({ K8S_API_URL: await fake.listen(), K8S_TOKEN: TOKEN, K8S_CA_CERT: 'unused' }))
    secrets = new ClusterSecrets(client)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fake.reset()
  })
  afterAll(async () => {
    client.onModuleDestroy()
    await fake.close()
  })

  const expected = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name: 'api-secrets', namespace: 'proj-my-app' },
    type: 'Opaque',
    data: { DB_URL: b64('postgres://u:p@h/db'), EMPTY: '', KOREAN: b64('값 with space\n') },
  }
  const values = { DB_URL: 'postgres://u:p@h/db', EMPTY: '', KOREAN: '값 with space\n' }

  it('creates an Opaque Secret named <service>-secrets with base64 data, in one request', async () => {
    await secrets.write('my-app', 'api', values)
    expect(fake.calls).toEqual([`POST ${LIST}`])
    expect(fake.seen[0].body).toEqual(expected)
  })

  it('replaces the whole object with PUT when it exists, and never sends PATCH', async () => {
    fake.answers.set(`POST ${LIST}`, exists)
    await secrets.write('my-app', 'api', values)
    expect(fake.calls).toEqual([`POST ${LIST}`, `PUT ${ONE}`])
    expect(fake.seen[1].body).toEqual(expected)
  })

  it('writes an empty Secret when there are no values', async () => {
    await secrets.write('my-app', 'api', {})
    expect(fake.seen[0].body).toMatchObject({ data: {} })
  })

  it.each([
    ['the space is missing (404 on POST)', `POST ${LIST}`, { status: 404, body: { reason: 'NotFound' } }, 'not_found', 1],
    ['the rule refuses it (422 on POST)', `POST ${LIST}`, { status: 422, body: { reason: 'Invalid' } }, 'rejected', 1],
    ['the account has no right (403 on POST)', `POST ${LIST}`, { status: 403, body: { reason: 'Forbidden' } }, 'forbidden', 1],
    ['a 409 that is not AlreadyExists', `POST ${LIST}`, { status: 409, body: { reason: 'Conflict' } }, 'conflict', 1],
    ['the Secret vanished before the PUT (404)', `PUT ${ONE}`, { status: 404, body: { reason: 'NotFound' } }, 'not_found', 2],
    ['the PUT is refused (422)', `PUT ${ONE}`, { status: 422, body: { reason: 'Invalid' } }, 'rejected', 2],
  ] as const)('fails with a ClusterError when %s', async (_, key, answer, kind, calls) => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    if (key.startsWith('PUT')) fake.answers.set(`POST ${LIST}`, exists)
    fake.answers.set(key, answer)
    await expect(secrets.write('my-app', 'api', values)).rejects.toMatchObject({ kind, status: 503 })
    expect(fake.seen).toHaveLength(calls)
  })

  it('keeps the values and the token out of logs and errors, on both requests', async () => {
    const spies = (['error', 'warn', 'log', 'debug', 'verbose'] as const).map((level) => vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined))
    const secret = { API_KEY: 'value-that-must-not-leak' }
    // PUT의 응답은 보낸 값을 그대로 담는다.
    const echo = { reason: 'Invalid', message: `data: ${b64(secret.API_KEY)}`, data: { API_KEY: b64(secret.API_KEY) } }
    const errors: unknown[] = []
    fake.answers.set(`POST ${LIST}`, { status: 422, body: echo })
    errors.push(await secrets.write('my-app', 'api', secret).catch((e: unknown) => e))
    fake.answers.set(`POST ${LIST}`, exists)
    fake.answers.set(`PUT ${ONE}`, { status: 422, body: echo })
    errors.push(await secrets.write('my-app', 'api', secret).catch((e: unknown) => e))
    fake.answers.set(`PUT ${ONE}`, { status: 200, body: echo })
    await expect(secrets.write('my-app', 'api', secret)).resolves.toBeUndefined()
    const told = JSON.stringify([spies.map((s) => s.mock.calls), errors, errors.map((e) => [(e as Error).message, (e as Error).stack, Object.entries(e as object)])])
    expect(told).not.toMatch(new RegExp(`${TOKEN}|${secret.API_KEY}|${b64(secret.API_KEY)}|API_KEY`))
    expect(spies[0]).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['', 'api'],
    ['My-App', 'api'],
    ['a/b', 'api'],
    ['../kube-system', 'api'],
    ['my-app', ''],
    ['my-app', 'Api'],
    ['my-app', '1api'],
    ['my-app', 'a/b'],
    ['my-app', 'api-'],
    ['my-app', 'a'.repeat(31)],
  ])('refuses slug %j with service %j before calling anything', async (slug, service) => {
    await expect(secrets.write(slug, service, values)).rejects.toThrow(/Not a valid (slug|service name)/)
    expect(fake.seen).toEqual([])
  })
})
